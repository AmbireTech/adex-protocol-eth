pragma solidity ^0.4.25;
pragma experimental ABIEncoderV2;

import "./SignatureValidator.sol";

library ChannelLibrary {
	uint constant MAX_VALIDITY = 365 days;

	// Both numbers are inclusive
	uint8 constant MIN_VALIDATOR_COUNT = 2;
	// This is an arbitrary number, but we impose this limit to restrict on-chain load; also to ensure the *3 operation is safe
	uint8 constant MAX_VALIDATOR_COUNT = 25;

	bytes32 constant SCHEMA_HASH = keccak256("Channel(address contract,address creator,bytes32 spec,address tokenAddr,uint tokenAmount,uint validUntil,address[] validators)");

	enum State {
		Unknown,
		Active,
		Expired
	}

	struct Channel {
		address creator;

		address tokenAddr;
		uint tokenAmount;

		uint validUntil;

		address[] validators;

		// finally, arbitrary bytes32 that allows to... @TODO document that this acts as a nonce
		bytes32 spec;
	}

	struct WithdrawalRequest {
		Channel channel;
		bytes32 stateRoot;
		bytes32[3][] signatures;
		bytes32[] proof;
		uint amountInTree;
	}

	function hash(Channel memory channel)
		internal
		view
		returns (bytes32)
	{
		// In this version of solidity, we can no longer keccak256() directly
		return keccak256(abi.encode(
			SCHEMA_HASH,
			address(this),
			channel.creator,
			channel.tokenAddr,
			channel.tokenAmount,
			channel.validUntil,
			channel.validators,
			channel.spec
		));
	}

	function isValid(Channel memory channel, uint currentTime)
		internal
		pure
		returns (bool)
	{
		if (channel.validators.length < MIN_VALIDATOR_COUNT) {
			return false;
		}
		if (channel.validators.length > MAX_VALIDATOR_COUNT) {
			return false;
		}
		if (channel.validUntil > currentTime + MAX_VALIDITY) {
			return false;
		}

		return true;
	}

	function isSignedBySupermajority(Channel memory channel, bytes32 toSign, bytes32[3][] memory signatures) 
		internal
		pure
		returns (bool)
	{
		if (signatures.length != channel.validators.length) {
			return false;
		}

		uint signs = 0;
		for (uint i=0; i<signatures.length; i++) {
			// NOTE: if a validator has not signed, you can just use SignatureMode.NO_SIG
			if (SignatureValidator.isValidSignature(toSign, channel.validators[i], signatures[i])) {
				signs++;
			}
		}
		return signs*3 >= channel.validators.length*2;
	}
}
