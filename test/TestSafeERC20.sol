pragma solidity ^0.5.2;

import "truffle/Assert.sol";
import "truffle/DeployedAddresses.sol";
import "../contracts/libs/SafeERC20.sol";
import "./mocks/Token.sol";
import "./mocks/BadToken.sol";
import "./mocks/WorstToken.sol";
// hack to force Truffle to compile this
import "./mocks/Libs.sol";

contract TestSafeERC20 {
	Token public token;
	BadToken public badToken;
	WorstToken public worstToken;

	constructor() public {
		token = new Token();
		token.setBalanceTo(address(this), 10000);

		badToken = new BadToken();
		badToken.setBalanceTo(address(this), 10000);

		worstToken = new WorstToken();
		worstToken.setBalanceTo(address(this), 10000);
	}

	function testToken() public {
		SafeERC20.transfer(address(token), address(0x0), 500);
		(bool success,) = address(this).call(abi.encodeWithSelector(TestSafeERC20(this).tokenFail.selector));
		Assert.equal(success, false, "token transfer is failing when amnt too big");
	}

	function testBadToken() public {
		SafeERC20.transfer(address(badToken), address(0x0), 500);
		(bool success,) = address(this).call(abi.encodeWithSelector(TestSafeERC20(this).badTokenFail.selector));
		Assert.equal(success, false, "token transfer is failing when amnt too big");
	}

	function testWorstToken() public {
		SafeERC20.transfer(address(worstToken), address(0x0), 500);
		(bool success,)  = address(this).call(abi.encodeWithSelector(TestSafeERC20(this).worstTokenFail.selector));
		Assert.equal(success, false, "token transfer is failing when amnt too big");
	}

	function tokenFail() public {
		SafeERC20.transfer(address(token), address(0x0), 10001);
	}
	function badTokenFail() public {
		SafeERC20.transfer(address(badToken), address(0x0), 10001);
	}
	function worstTokenFail() public {
		SafeERC20.transfer(address(worstToken), address(0x0), 10001);
	}
}
