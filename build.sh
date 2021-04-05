#!/usr/bin/env bash
set -e

mkdir -p temp 
solc --abi --bin contracts/OUTPACE.sol -o temp 
solc --overwrite --abi contracts/Identity.sol -o temp 
solc --overwrite --abi contracts/IdentityFactory.sol -o temp 
solc --overwrite --abi contracts/StakignPool.sol -o temp 
mkdir -p resources abi
# AdexCore abi
mv temp/OUTPACE.abi abi/OUTPACE.json
mv temp/Identity.abi abi/Identity.json  
mv temp/IdentityFactory.abi abi/IdentityFactory.json
mv temp/StakignPool.abi abi/StakignPool.json
# AdexCore bytecode
bytecode="`cat temp/OUTPACE.bin`"; # read file contents into var
echo "\"$bytecode\"" > "resources/bytecode/OUTPACE.json" # write to file
rm -r temp/
