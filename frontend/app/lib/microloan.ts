export const MICROLOAN_ABI = [
  "function nextLoanId() view returns (uint256)",
  "function loans(uint256 loanId) view returns (address borrower, address lender, uint256 principal, uint256 repayment, uint64 dueDate, uint8 status)",
  "function requestLoan(uint256 principal, uint256 repayment, uint64 durationSeconds) returns (uint256 loanId)",
  "function fund(uint256 loanId) payable",
  "function withdraw(uint256 loanId)",
  "function repay(uint256 loanId) payable",
] as const;

export type Loan = {
  id: bigint;
  borrower: string;
  lender: string;
  principal: bigint;
  repayment: bigint;
  dueDate: bigint;
  status: number;
};
