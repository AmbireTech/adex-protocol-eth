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
		token.setBalanceTo(address(this), 10000);

		badToken = new BadToken();
		badToken.setBalanceTo(address(this), 10000);

		worstToken = new WorstToken();
		worstToken.setBalanceTo(address(this), 10000);
	}

	function testToken() public {
		SafeERC20.transfer(address(token), 0x0, 500);
		Assert.equal(address(this).call(TestSafeERC20(this).tokenFail.selector), false, "token transfer is failing when amnt too big");
	}

	function testBadToken() public {
		SafeERC20.transfer(address(badToken), 0x0, 500);
		Assert.equal(address(this).call(TestSafeERC20(this).badTokenFail.selector), false, "token transfer is failing when amnt too big");
	}

	function testWorstToken() public {
		SafeERC20.transfer(address(worstToken), 0x0, 500);
		Assert.equal(address(this).call(TestSafeERC20(this).worstTokenFail.selector), false, "token transfer is failing when amnt too big");
	}

	function tokenFail() public {
		SafeERC20.transfer(address(token), 0x0, 10001);
	}
	function badTokenFail() public {
		SafeERC20.transfer(address(badToken), 0x0, 10001);
	}
	function worstTokenFail() public {
		SafeERC20.transfer(address(worstToken), 0x0, 10001);
	}
}
