pragma solidity 0.4.24;

library ChannelLibrary {
	// Both numbers are inclusive
	uint8 constant MIN_VALIDATOR_COUNT = 2;
	// This is an arbitrary number, but we impose this limit to restrict on-chain load; also to ensure the *3 operation is safe
	uint8 constant MAX_VALIDATOR_COUNT = 25;
	
	bytes32 constant struct SCHEMA_HASH = keccak256("Channel(address contract,address creator,bytes32 spec,address tokenAddr,uint tokenAmount,uint validUntil,address[] validators)")

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

	function hash(Channel memory channel) internal pure returns (bytes32) {
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

	function isValid(Channel memory channel)
		internal
		pure
		returns (bool)
	{
		// @TODO
		return true;
	}
}
