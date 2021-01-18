// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.0;

interface IADXToken {
	function totalSupply() external returns (uint);
	function mint(address owner, uint amount) external;
	function changeSupplyController(address newSupplyController) external;
}

contract ADXSupplyController {
	enum GovernanceLevel { None, Mint, All }
	mapping (address => uint8) public governance;
	constructor() {
		governance[msg.sender] = uint8(GovernanceLevel.All);
	}

	function mint(IADXToken token, address owner, uint amount) external {
		require(governance[msg.sender] >= uint8(GovernanceLevel.Mint), 'NOT_GOVERNANCE');
		uint totalSupplyAfter = token.totalSupply() + amount;
		// 10 September 2020
		if (block.timestamp < 1599696000) {
			// 50M * 10**18
			require(totalSupplyAfter <= 50000000000000000000000000, 'EARLY_MINT_TOO_LARGE');
		} else {
			// 150M * 10**18
			require(totalSupplyAfter <= 150000000000000000000000000, 'MINT_TOO_LARGE');
		}
		token.mint(owner, amount);
	}

	function changeSupplyController(IADXToken token, address newSupplyController) external {
		require(governance[msg.sender] >= uint8(GovernanceLevel.All), 'NOT_GOVERNANCE');
		token.changeSupplyController(newSupplyController);
	}

	function setGovernance(address addr, uint8 level) external {
		require(governance[msg.sender] >= uint8(GovernanceLevel.All), 'NOT_GOVERNANCE');
		governance[addr] = level;
	}
}
