pragma solidity 0.4.24;

import "truffle/Assert.sol";
import "truffle/DeployedAddresses.sol";
import "../contracts/libs/SafeERC20.sol";
import "./mocks/Token.sol";
import "./mocks/BadToken.sol";
import "./mocks/WorstToken.sol";

contract TestSafeERC20 {
	Token public token;
	BadToken public badToken;
	WorstToken public worstToken;

	constructor() public {
		token = new Token();
		badToken = new BadToken();
		worstToken = new WorstToken();
		token.setBalanceTo(address(this), 10000);
		badToken.setBalanceTo(address(this), 10000);
		worstToken.setBalanceTo(address(this), 10000);
	}

	function testToken() public {
		SafeERC20.transfer(address(token), 0x0, 500);
		// @TODO test failures
	}

	// function testBadToken() public {
	// 	SafeERC20.transfer(address(badToken), 0x0, 500);
	// 	// @TODO test failures
	// }

	function testWorstToken() public {
		SafeERC20.transfer(address(worstToken), 0x0, 500);
		// @TODO test failures
	}
}