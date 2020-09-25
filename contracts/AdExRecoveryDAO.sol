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
    uint256 public immutable MINIMUM_RECOVERY_DELAY; // in seconds
    uint256 public recoveryDelay; // in seconds

    event LogAddProposer(address proposer, uint256 timestamp);
    event LogRemoveProposer(address proposer, uint256 timestamp);
    event LogProposeRecovery(bytes32 recoveryId, address proposer, address identity, uint256 timestamp);
    event LogFinalizeRecovery(bytes32 recoveryId, address proposer, address identity, uint256 timestamp);
    event LogCancelRecovery(address proposer, address identity, uint256 timestamp);
    event LogChangeAdmin(address oldAmin, address newAdmin);
    event LogChangeRecoveryDelay(uint256 previousDelay, uint256 newDelay);

    mapping(address => bool) public proposers;
    mapping(bytes32 => uint256) public recovery;

    constructor(address admin, uint256 minDelay, uint256 delay) public {
        require(delay > 0, 'INVALID,_DELAY');
        require(admin != address(0), 'INVALID_ADMIN');

        adminAddr = admin; 
        recoveryDelay = delay;
        MINIMUM_RECOVERY_DELAY = minDelay;
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
        bytes32 recoveryId = request.hash();
        recovery[recoveryId] = now + recoveryDelay;
        emit LogProposeRecovery(recoveryId, request.proposer, request.identity, now);
    }

    function finalizeRecovery(RecoveryRequestLibrary.RecoveryRequest memory request) external {
        bytes32 recoveryId = request.hash();
        require(proposers[msg.sender] == true, 'ONLY_WHITELISTED_PROPOSERS');
        require(request.proposer == msg.sender, 'INVALID_REQUEST');
        require(recovery[recoveryId] >= now, 'ACTIVE_DELAY');
        
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
        delete recovery[recoveryId];
        emit LogFinalizeRecovery(recoveryId, request.proposer, request.identity, now);
    }

    function cancelRecovery(RecoveryRequestLibrary.RecoveryRequest memory request) external {
        require(request.identity == msg.sender || msg.sender == adminAddr, 'ONLY_ACCOUNT_OR_ADMIN_CAN_CANCEL');
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

    function changeRecoveryDelay(uint256 newDelay) external {
        require(msg.sender == adminAddr, 'ONLY_ADMIN_CAN_CALL');
        require(newDelay >= MINIMUM_RECOVERY_DELAY, 'NEW_DELAY_BELOW_MINIMUM');
        uint256 oldDelay = recoveryDelay;
        recoveryDelay = newDelay;
        emit LogChangeRecoveryDelay(oldDelay, newDelay);
    }
}
