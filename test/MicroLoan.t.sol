// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {MicroLoan} from "../contracts/MicroLoan.sol";

interface Vm {
    function deal(address account, uint256 newBalance) external;
    function warp(uint256 newTimestamp) external;
    function prank(address sender) external;
}

contract MicroLoanTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function testRequestFundWithdrawAndRepay() external {
        MicroLoan loan = new MicroLoan();
        address borrower = address(0xCAFE);
        address lender = address(0xBEEF);
        vm.deal(borrower, 2 ether);
        vm.deal(lender, 2 ether);

        vm.prank(borrower);
        uint256 loanId = loan.requestLoan(1 ether, 1.02 ether, 30 days);
        (,,,, uint64 dueDate, MicroLoan.Status requestedStatus) = loan.loans(loanId);
        require(requestedStatus == MicroLoan.Status.Requested, "request status");
        require(dueDate > block.timestamp, "due date");

        vm.prank(lender);
        loan.fund{value: 1 ether}(loanId);
        (,,,,, MicroLoan.Status fundedStatus) = loan.loans(loanId);
        require(fundedStatus == MicroLoan.Status.Funded, "funded status");

        vm.prank(borrower);
        loan.withdraw(loanId);
        (,,,,, MicroLoan.Status withdrawnStatus) = loan.loans(loanId);
        require(withdrawnStatus == MicroLoan.Status.Withdrawn, "withdrawn status");

        uint256 lenderBalanceBefore = lender.balance;
        vm.prank(borrower);
        loan.repay{value: 1.02 ether}(loanId);
        (,,,,, MicroLoan.Status repaidStatus) = loan.loans(loanId);
        require(repaidStatus == MicroLoan.Status.Repaid, "repaid status");
        require(lender.balance == lenderBalanceBefore + 1.02 ether, "lender repayment");
    }

    function testBorrowerCannotFundOwnRequest() external {
        MicroLoan loan = new MicroLoan();
        address borrower = address(0xCAFE);
        vm.deal(borrower, 1 ether);

        vm.prank(borrower);
        uint256 loanId = loan.requestLoan(1 ether, 1.02 ether, 1 days);
        vm.prank(borrower);
        (bool success, ) = address(loan).call{value: 1 ether}(
            abi.encodeCall(MicroLoan.fund, (loanId))
        );
        require(!success, "self funding should fail");
    }

    function testAnyoneCanMarkDefaultAfterDeadline() external {
        MicroLoan loan = new MicroLoan();
        address borrower = address(0xCAFE);
        address lender = address(0xBEEF);
        vm.deal(borrower, 1 ether);
        vm.deal(lender, 1 ether);

        vm.prank(borrower);
        uint256 loanId = loan.requestLoan(1 ether, 1.02 ether, 1 days);
        vm.prank(lender);
        loan.fund{value: 1 ether}(loanId);
        vm.prank(borrower);
        loan.withdraw(loanId);

        (,,,, uint64 dueDate, ) = loan.loans(loanId);
        vm.warp(uint256(dueDate) + 1);
        loan.markDefault(loanId);
        (,,,,, MicroLoan.Status defaultedStatus) = loan.loans(loanId);
        require(defaultedStatus == MicroLoan.Status.Defaulted, "default status");
    }

    function testZeroDurationIsRejected() external {
        MicroLoan loan = new MicroLoan();
        (bool success, ) = address(loan).call(
            abi.encodeCall(MicroLoan.requestLoan, (1 ether, 1.02 ether, 0))
        );
        require(!success, "zero duration should fail");
    }
}
