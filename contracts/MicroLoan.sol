// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MicroLoan {
    enum Status {
        Requested,
        Funded,
        Withdrawn,
        Repaid,
        Defaulted
    }

    struct Loan {
        address borrower;
        address lender;
        uint256 principal;
        uint256 repayment;
        uint64 dueDate;
        Status status;
    }

    uint256 public nextLoanId;
    mapping(uint256 => Loan) public loans;

    bool private locked;

    event LoanRequested(
        uint256 indexed loanId,
        address indexed borrower,
        uint256 principal,
        uint256 repayment,
        uint64 dueDate
    );

    event LoanFunded(
        uint256 indexed loanId,
        address indexed lender,
        uint256 principal
    );

    event LoanWithdrawn(
        uint256 indexed loanId,
        address indexed borrower,
        uint256 amount
    );

    event LoanRepaid(
        uint256 indexed loanId,
        address indexed borrower,
        address indexed lender,
        uint256 amount
    );

    event LoanDefaulted(
        uint256 indexed loanId,
        address indexed caller,
        Status indexed previousStatus,
        uint256 principalRefunded
    );

    error InvalidLoanId(uint256 loanId);
    error InvalidPrincipal(uint256 principal);
    error RepaymentBelowPrincipal(uint256 principal, uint256 repayment);
    error InvalidDueDate(uint256 dueDate, uint256 nowTimestamp);
    error InvalidState(uint256 loanId, Status currentStatus);
    error BorrowerOnly(uint256 loanId);
    error BorrowerCannotFundOwnLoan(uint256 loanId);
    error IncorrectValue(uint256 expected, uint256 actual);
    error DeadlinePassed(uint256 loanId, uint256 dueDate);
    error DeadlineNotPassed(uint256 loanId, uint256 dueDate);
    error ETHTransferFailed(address recipient, uint256 amount);
    error ReentrancyDetected();

    modifier nonReentrant() {
        if (locked) revert ReentrancyDetected();
        locked = true;
        _;
        locked = false;
    }

    function requestLoan(
        uint256 principal,
        uint256 repayment,
        uint64 dueDate
    ) external returns (uint256 loanId) {
        dueDate = uint64(dueDate + block.timestamp);
        if (principal == 0) revert InvalidPrincipal(principal);
        if (repayment < principal) revert RepaymentBelowPrincipal(principal, repayment);
        if (dueDate <= block.timestamp) revert InvalidDueDate(dueDate, block.timestamp);

        loanId = nextLoanId++;
        loans[loanId] = Loan({
            borrower: msg.sender,
            lender: address(0),
            principal: principal,
            repayment: repayment,
            dueDate: dueDate,
            status: Status.Requested
        });

        emit LoanRequested(loanId, msg.sender, principal, repayment, dueDate);
    }

    function fund(uint256 loanId) external payable nonReentrant {
        Loan storage loan = _getLoan(loanId);

        if (loan.status != Status.Requested) revert InvalidState(loanId, loan.status);
        if (msg.sender == loan.borrower) revert BorrowerCannotFundOwnLoan(loanId);
        if (block.timestamp > loan.dueDate) revert DeadlinePassed(loanId, loan.dueDate);
        if (msg.value != loan.principal) revert IncorrectValue(loan.principal, msg.value);

        loan.lender = msg.sender;
        loan.status = Status.Funded;

        emit LoanFunded(loanId, msg.sender, loan.principal);
    }

    function withdraw(uint256 loanId) external nonReentrant {
        Loan storage loan = _getLoan(loanId);

        if (msg.sender != loan.borrower) revert BorrowerOnly(loanId);
        if (loan.status != Status.Funded) revert InvalidState(loanId, loan.status);
        if (block.timestamp > loan.dueDate) revert DeadlinePassed(loanId, loan.dueDate);

        loan.status = Status.Withdrawn;
        uint256 amount = loan.principal;

        _sendValue(loan.borrower, amount);

        emit LoanWithdrawn(loanId, loan.borrower, amount);
    }

    function repay(uint256 loanId) external payable nonReentrant {
        Loan storage loan = _getLoan(loanId);

        if (msg.sender != loan.borrower) revert BorrowerOnly(loanId);
        if (loan.status != Status.Withdrawn) revert InvalidState(loanId, loan.status);
        if (block.timestamp > loan.dueDate) revert DeadlinePassed(loanId, loan.dueDate);
        if (msg.value != loan.repayment) revert IncorrectValue(loan.repayment, msg.value);

        loan.status = Status.Repaid;
        _sendValue(loan.lender, loan.repayment);

        emit LoanRepaid(loanId, loan.borrower, loan.lender, loan.repayment);
    }

    function markDefault(uint256 loanId) external nonReentrant {
        Loan storage loan = _getLoan(loanId);
        Status previousStatus = loan.status;

        if (previousStatus == Status.Repaid || previousStatus == Status.Defaulted) {
            revert InvalidState(loanId, previousStatus);
        }
        if (block.timestamp <= loan.dueDate) revert DeadlineNotPassed(loanId, loan.dueDate);

        if (previousStatus == Status.Requested) {
            loan.status = Status.Defaulted;
            emit LoanDefaulted(loanId, msg.sender, previousStatus, 0);
            return;
        }

        if (previousStatus == Status.Funded) {
            uint256 refund = loan.principal;
            loan.status = Status.Defaulted;
            _sendValue(loan.lender, refund);
            emit LoanDefaulted(loanId, msg.sender, previousStatus, refund);
            return;
        }

        // previousStatus == Status.Withdrawn
        loan.status = Status.Defaulted;
        emit LoanDefaulted(loanId, msg.sender, previousStatus, 0);
    }

    function _getLoan(uint256 loanId) internal view returns (Loan storage loan) {
        if (loanId >= nextLoanId) revert InvalidLoanId(loanId);
        loan = loans[loanId];
    }

    function _sendValue(address recipient, uint256 amount) private {
        (bool success, ) = payable(recipient).call{value: amount}("");
        if (!success) revert ETHTransferFailed(recipient, amount);
    }
}