const { Wallets } = require('fabric-network');
const fs = require('fs');
const path = require('path');

async function main() {
  try {
    const walletPath = path.join(__dirname, '../src/wallet');
    const wallet = await Wallets.newFileSystemWallet(walletPath);

    const credPath = path.join(
      __dirname,
      '../fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp'
    );

    const cert = fs.readFileSync(
      path.join(credPath, 'signcerts', fs.readdirSync(path.join(credPath, 'signcerts'))[0])
    ).toString();

    const key = fs.readFileSync(
      path.join(credPath, 'keystore', fs.readdirSync(path.join(credPath, 'keystore'))[0])
    ).toString();

    const identity = {
      credentials: {
        certificate: cert,
        privateKey: key,
      },
      mspId: 'Org1MSP',
      type: 'X.509',
    };

    await wallet.put('appUser', identity);

    console.log('✅ Wallet setup complete (appUser)');
  } catch (error) {
    console.error(error);
  }
}

main();