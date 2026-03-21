package main

import (
	"encoding/json"
	"fmt"

	"github.com/hyperledger/fabric-contract-api-go/contractapi"
)

type BitCertContract struct {
	contractapi.Contract
}

type Certificate struct {
	CertHash  string `json:"certHash"`
	Signature string `json:"signature"`
	OrgMSPID  string `json:"orgMSPID"`
	FilePath  string `json:"filePath"`
	IsRevoked bool   `json:"isRevoked"`
}

type Organisation struct {
	MSPID     string `json:"mspID"`
	PublicKey string `json:"publicKey"`
}

func (c *BitCertContract) CertificateExists(ctx contractapi.TransactionContextInterface, certHash string) (bool, error) {
	data, err := ctx.GetStub().GetState(certHash)
	if err != nil {
		return false, err
	}

	return data != nil, nil
}

func (c *BitCertContract) StoreCertificate(ctx contractapi.TransactionContextInterface, certHash string, ecdsaSignature string, orgMSPID string, filePath string) error {
	exists, err := c.CertificateExists(ctx, certHash)
	if err != nil {
		return err
	}
	if exists {
		return fmt.Errorf("certificate already exists")
	}

	cert := Certificate{
		CertHash:  certHash,
		Signature: ecdsaSignature,
		OrgMSPID:  orgMSPID,
		FilePath:  filePath,
		IsRevoked: false,
	}

	certJSON, err := json.Marshal(cert)
	if err != nil {
		return fmt.Errorf("failed to marshal certificate: %w", err)
	}

	return ctx.GetStub().PutState(certHash, certJSON)
}

func (c *BitCertContract) GetCertificate(ctx contractapi.TransactionContextInterface, certHash string) (*Certificate, error) {
	certJSON, err := ctx.GetStub().GetState(certHash)
	if err != nil {
		return nil, fmt.Errorf("failed to read certificate: %w", err)
	}
	if certJSON == nil {
		return nil, fmt.Errorf("certificate with hash %s does not exist", certHash)
	}

	var cert Certificate
	if err := json.Unmarshal(certJSON, &cert); err != nil {
		return nil, fmt.Errorf("failed to unmarshal certificate: %w", err)
	}

	return &cert, nil
}

func (c *BitCertContract) RegisterOrg(ctx contractapi.TransactionContextInterface, orgMSPID string, publicKey string) error {
	existing, err := ctx.GetStub().GetState(orgMSPID)
	if err != nil {
		return fmt.Errorf("failed to read organisation: %w", err)
	}

	if existing != nil {
		return fmt.Errorf("organisation %s already registered", orgMSPID)
	}

	org := Organisation{
		MSPID:     orgMSPID,
		PublicKey: publicKey,
	}

	orgJSON, err := json.Marshal(org)
	if err != nil {
		return fmt.Errorf("failed to marshal organisation: %w", err)
	}

	return ctx.GetStub().PutState(orgMSPID, orgJSON)
}

func (c *BitCertContract) RevokeCertificate(ctx contractapi.TransactionContextInterface, certHash string) error {
	certJSON, err := ctx.GetStub().GetState(certHash)
	if err != nil {
		return fmt.Errorf("failed to read certificate: %w", err)
	}

	if certJSON == nil {
		return fmt.Errorf("certificate with hash %s does not exist", certHash)
	}

	var cert Certificate
	err = json.Unmarshal(certJSON, &cert)
	if err != nil {
		return fmt.Errorf("failed to unmarshal certificate: %w", err)
	}

	if cert.IsRevoked {
		return fmt.Errorf("certificate already revoked")
	}

	cert.IsRevoked = true

	updatedJSON, err := json.Marshal(cert)
	if err != nil {
		return fmt.Errorf("failed to marshal updated certificate: %w", err)
	}

	return ctx.GetStub().PutState(certHash, updatedJSON)
}

func (c *BitCertContract) GetOrgPublicKey(ctx contractapi.TransactionContextInterface, orgMSPID string) (string, error) {
	orgJSON, err := ctx.GetStub().GetState(orgMSPID)
	if err != nil {
		return "", fmt.Errorf("failed to read organisation: %w", err)
	}
	if orgJSON == nil {
		return "", fmt.Errorf("organisation with MSPID %s does not exist", orgMSPID)
	}

	var org Organisation
	if err := json.Unmarshal(orgJSON, &org); err != nil {
		return "", fmt.Errorf("failed to unmarshal organisation: %w", err)
	}

	return org.PublicKey, nil
}

func main() {
	contract := new(BitCertContract)
	cc, err := contractapi.NewChaincode(contract)
	if err != nil {
		panic(fmt.Sprintf("failed to create chaincode: %v", err))
	}

	if err := cc.Start(); err != nil {
		panic(fmt.Sprintf("failed to start chaincode: %v", err))
	}
}
