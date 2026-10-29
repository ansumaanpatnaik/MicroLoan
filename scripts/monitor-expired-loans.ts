import "dotenv/config";
import { Contract, JsonRpcProvider, Wallet, getAddress, isAddress } from "ethers";

const rpcUrl = process.env.SEPOLIA_RPC_URL;
const privateKey = process.env.SEPOLIA_PRIVATE_KEY;
const configuredAddress = process.env.MICROLOAN_ADDRESS;
const pollIntervalMs = Number(process.env.LOAN_MONITOR_INTERVAL_MS ?? "60000");

if (!rpcUrl || !privateKey || !configuredAddress) {
  throw new Error(
    "Set SEPOLIA_RPC_URL, SEPOLIA_PRIVATE_KEY, and MICROLOAN_ADDRESS in the project-root .env file.",
  );
}

if (!isAddress(configuredAddress)) {
  throw new Error("MICROLOAN_ADDRESS must be a valid Ethereum address.");
}

if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs <= 0) {
  throw new Error("LOAN_MONITOR_INTERVAL_MS must be a positive whole number.");
}

const contractAddress = getAddress(configuredAddress);
const provider = new JsonRpcProvider(rpcUrl);
const signer = new Wallet(privateKey, provider);
const contract = new Contract(
  contractAddress,
  [
    "function nextLoanId() view returns (uint256)",
    "function loans(uint256 loanId) view returns (address borrower, address lender, uint256 principal, uint256 repayment, uint64 dueDate, uint8 status)",
    "function markDefault(uint256 loanId)",
    "function markExpired(uint256 loanId)",
  ],
  signer,
);

async function checkExpiredLoans(): Promise<void> {
  const [nextLoanIdResult, latestBlock] = await Promise.all([
    contract.getFunction("nextLoanId").staticCall(),
    provider.getBlock("latest"),
  ]);
  if (!latestBlock) {
    throw new Error("The RPC provider returned no latest block.");
  }

  const nextLoanId = BigInt(nextLoanIdResult);
  const chainTimestamp = BigInt(latestBlock.timestamp);

  for (let loanId = 0n; loanId < nextLoanId; loanId += 1n) {
    const loan = await contract.getFunction("loans").staticCall(loanId);
    const dueDate = BigInt(loan[4]);
    const status = Number(loan[5]);

    if (chainTimestamp <= dueDate) continue;

    const action =
      status === 0 || status === 1
        ? "markExpired"
        : status === 2
          ? "markDefault"
          : undefined;
    if (!action) continue;

    try {
      console.log(`Submitting ${action} for loan ${loanId}...`);
      const transaction = await contract.getFunction(action).send(loanId);
      const receipt = await transaction.wait();
      if (!receipt) {
        throw new Error(`Transaction ${transaction.hash} was not mined.`);
      }

      console.log(
        `${action} confirmed for loan ${loanId} in transaction ${receipt.hash}.`,
      );
    } catch (error) {
      console.error(`Failed to process expired loan ${loanId}:`, error);
    }
  }
}

console.log(`Monitoring ${contractAddress} with signer ${signer.address}.`);
console.log(`Polling every ${pollIntervalMs} ms.`);

while (true) {
  try {
    await checkExpiredLoans();
  } catch (error) {
    console.error("Loan expiry check failed; it will be retried next poll:", error);
  }

  await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
}
