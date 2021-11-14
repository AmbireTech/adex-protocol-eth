// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.1;

import "./Identity.sol";
import "./IdentityFactory.sol";
import "./wallet/QuickAccManager.sol";

contract DeployAmbire {
	IdentityFactory public immutable factory;
	Identity public immutable baseIdentity;
	QuickAccManager public immutable manager;
	constructor() {
		factory = new IdentityFactory(0x23C2c34f38ce66ccC10E71e9bB2A06532D52C5E9);
		address[] memory addrs;
		baseIdentity = new Identity(addrs);
		manager = new QuickAccManager();
	}
}
