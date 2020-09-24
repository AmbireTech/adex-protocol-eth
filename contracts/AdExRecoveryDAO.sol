// SPDX-License-Identifier: agpl-3.0

pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "./Identity.sol";

library RecoveryRequestLibrary {
    struct RecoveryRequest {
        address identity;
        address newUserAddress;
        address proposer;   
        uint256 timestamp; 
    }

    function hash(RecoveryRequest memory request)
        internal
        view
        returns (bytes32)
    {
        return keccak256(abi.encode(
            address(this),
            request.identity,
            request.newUserAddress,
            request.proposer,
            request.timestamp
        ));
    }
}

contract AdExRecoveryDAO {
    using RecoveryRequestLibrary for RecoveryRequestLibrary.RecoveryRequest;

    address public adminAddr;
    uint256 public recoveryDelay;

    event LogAddProposer(address proposer, uint256 timestamp);
    event LogRemoveProposer(address proposer, uint256 timestamp);
    event LogProposeRecovery(address proposer, address identity, uint256 timestamp);
    event LogFinalizeRecovery(address proposer, address identity, uint256 timestamp);
    event LogCancelRecovery(address proposer, address identity, uint256 timestamp);
    event LogChangeAdmin(address oldAmin, address newAdmin);

    mapping(address => bool) public proposers;
    mapping(bytes32 => uint256) public recovery;

    constructor(address admin, uint256 delay) public {
        require(delay > 0, 'INVALID_DELAY');
        require(admin != address(0), 'INVALID_ADMIN');

        adminAddr = admin; 
        recoveryDelay = delay;
    }

    function addProposer(address proposer) external {
        require(msg.sender == adminAddr, 'ONLY_ADMIN_CAN_ADD_PROPOSER');
        proposers[proposer] = true;
        emit LogAddProposer(proposer, now);
    }

    function removeProposer(address proposer) external {
        require(msg.sender == adminAddr, 'ONLY_ADMIN_CAN_REMOVE_PROPOSER');
        delete proposers[proposer];
        emit LogRemoveProposer(proposer, now);
    }

    function proposeRecovery(RecoveryRequestLibrary.RecoveryRequest memory request) external {
        require(proposers[msg.sender] == true, 'ONLY_WHITELISTED_PROPOSER');
        require(request.proposer == msg.sender, 'INVALID_REQUEST');
        recovery[request.hash()] = now + recoveryDelay;
        emit LogProposeRecovery(request.proposer, request.identity, now);
    }

    function finalizeRecovery(RecoveryRequestLibrary.RecoveryRequest memory request) external {
        require(proposers[msg.sender] == true, 'ONLY_WHITELISTED_PROPOSERS');
        require(request.proposer == msg.sender, 'INVALID_REQUEST');
        require(recovery[request.hash()] >= now, 'DELAY_TIME');
        
        Identity.Transaction[] memory recoverTransaction = new Identity.Transaction[](1);
        recoverTransaction[0] = Identity.Transaction(
            request.identity,
            Identity(request.identity).nonce(),
            address(0),
            0,
            request.identity,
            0,
            abi.encodeWithSelector(
                Identity.setAddrPrivilege.selector,
                request.newUserAddress,
                uint8(Identity.PrivilegeLevel.Transactions)
            )
        );

        Identity(request.identity).executeBySender(recoverTransaction);
        delete recovery[request.hash()];
        emit LogFinalizeRecovery(request.proposer, request.identity, now);
    }

    function cancelRecovery(RecoveryRequestLibrary.RecoveryRequest memory request) external {
        require(request.identity == msg.sender, 'ONLY_ACCOUNT_CAN_RECOVER');
        bytes32 recoveryHash = request.hash();
        require(recovery[recoveryHash] != 0, 'CAN_NOT_CANCEL');
        delete recovery[recoveryHash];
        emit LogCancelRecovery(request.proposer, msg.sender, now);
    }

    function changeAdmin(address newAdmin) external {
        require(msg.sender == adminAddr, 'ONLY_ADMIN_CAN_CALL');
        require(newAdmin != adminAddr, 'INVALID_NEW_ADMIN');
        adminAddr = newAdmin;
        emit LogChangeAdmin(msg.sender, newAdmin);
    }
}
