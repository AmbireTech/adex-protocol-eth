#!/usr/bin/env bash

mkdir -p temp 
solc --abi --bin contracts/AdExCore.sol -o temp 
solc --overwrite --abi contracts/Identity.sol -o temp 
solc --overwrite --abi contracts/IdentityFactory.sol -o temp 
mkdir -p resources abi
# AdexCore abi
mv temp/AdExCore.abi abi/AdExCore.json
mv temp/Identity.abi abi/Identity.json  
mv temp/IdentityFactory.abi abi/IdentityFactory.json
# AdexCore bytecode
mv temp/AdExCore.bin resources/bytecode/AdExCore.json
rm -r temp/