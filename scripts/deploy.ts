import "dotenv/config";
import { readFile } from "node:fs/promises";
import { ContractFactory, JsonRpcProvider, Wallet } from "ethers";

const rpcUrl = process.env.SEPOLIA_RPC_URL;
const privateKey = process.env.SEPOLIA_PRIVATE_KEY;

if (!rpcUrl || !privateKey) {
  throw new Error("Set SEPOLIA_RPC_URL and SEPOLIA_PRIVATE_KEY in the project-root .env file.");
}

const provider = new JsonRpcProvider(rpcUrl);
const deployer = new Wallet(privateKey, provider);
const artifactPath = new URL("../artifacts/contracts/MicroLoan.sol/MicroLoan.json", import.meta.url);
const artifact = JSON.parse(await readFile(artifactPath, "utf8")) as {
  abi: ConstructorParameters<typeof ContractFactory>[0];
  bytecode: string;
};

const contract = await new ContractFactory(artifact.abi, artifact.bytecode, deployer).deploy();
await contract.waitForDeployment();

console.log(`MicroLoan deployed to: ${await contract.getAddress()}`);
console.log(`Deployer: ${deployer.address}`);
await provider.destroy();
