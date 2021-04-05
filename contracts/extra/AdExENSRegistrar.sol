// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.0;

// Copy-paste from @ensdomains/ens/contracts/ENS.sol
interface ENS {
    // Logged when the owner of a node assigns a new owner to a subnode.
    event NewOwner(bytes32 indexed node, bytes32 indexed label, address newOwner);

    // Logged when the owner of a node transfers ownership to a new account.
    event Transfer(bytes32 indexed node, address newOwner);

    // Logged when the resolver for a node changes.
    event NewResolver(bytes32 indexed node, address newResolver);

    // Logged when the TTL of a node changes
    event NewTTL(bytes32 indexed node, uint64 ttl);

    function setSubnodeOwner(bytes32 node, bytes32 label, address newOwner) external;
    function setResolver(bytes32 node, address newResolver) external;
    function setOwner(bytes32 node, address newOwner) external;
    function setTTL(bytes32 node, uint64 newTtl) external;
    function owner(bytes32 node) external view returns (address);
    function resolver(bytes32 node) external view returns (address);
    function ttl(bytes32 node) external view returns (uint64);

}

// Copy-paste from @ensdomains/resolver/contracts/Resolver.sol
interface Resolver {
    event AddrChanged(bytes32 indexed node, address a);
    event AddressChanged(bytes32 indexed node, uint coinType, bytes newAddress);
    event NameChanged(bytes32 indexed node, string name);
    event ABIChanged(bytes32 indexed node, uint256 indexed contentType);
    event PubkeyChanged(bytes32 indexed node, bytes32 x, bytes32 y);
    event TextChanged(bytes32 indexed node, string indexed indexedKey, string key);
    event ContenthashChanged(bytes32 indexed node, bytes hash);

    function ABI(bytes32 node, uint256 contentTypes) external view returns (uint256, bytes memory);
    function addr(bytes32 node) external view returns (address);
    function contenthash(bytes32 node) external view returns (bytes memory);
    function dnsrr(bytes32 node) external view returns (bytes memory);
    function name(bytes32 node) external view returns (string memory);
    function pubkey(bytes32 node) external view returns (bytes32 x, bytes32 y);
    function text(bytes32 node, string calldata key) external view returns (string memory);
    function interfaceImplementer(bytes32 node, bytes4 interfaceID) external view returns (address);

    function setABI(bytes32 node, uint256 contentType, bytes calldata data) external;
    function setAddr(bytes32 node, address _addr) external;
    function setContenthash(bytes32 node, bytes calldata hash) external;
    function setDnsrr(bytes32 node, bytes calldata data) external;
    function setName(bytes32 node, string calldata _name) external;
    function setPubkey(bytes32 node, bytes32 x, bytes32 y) external;
    function setText(bytes32 node, string calldata key, string calldata value) external;
    function setInterface(bytes32 node, bytes4 interfaceID, address implementer) external;

    function supportsInterface(bytes4 interfaceID) external pure returns (bool);
}


contract AdExENSManager {
    ENS immutable ens;
    bytes32 immutable rootNode;

    constructor(ENS ensAddr, bytes32 node) {
        ens = ensAddr;
        rootNode = node;
    }

    function register(bytes32 label, address owner) public {
        bytes32 subdomainNode = keccak256(abi.encodePacked(rootNode, label));
        address currentOwner = ens.owner(subdomainNode);
        require(currentOwner == address(0x0) || currentOwner == msg.sender);
        ens.setSubnodeOwner(rootNode, label, owner);
    }

    // Register a subdomain and point it to an address
    function registerAndSetup(Resolver resolver, bytes32 label, address identity) public {
        bytes32 subdomainNode = keccak256(abi.encodePacked(rootNode, label));
        address currentOwner = ens.owner(subdomainNode);
        require(currentOwner == address(0x0) || currentOwner == msg.sender);
        ens.setSubnodeOwner(rootNode, label, address(this));
	ens.setResolver(subdomainNode, address(resolver));
	resolver.setAddr(subdomainNode, identity);
	// Give ownership to the Identity
	ens.setOwner(subdomainNode, identity);
    }
}
