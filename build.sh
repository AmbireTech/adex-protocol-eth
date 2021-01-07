#!/usr/bin/env bash
set -e

mkdir -p temp 
solc --abi --bin contracts/AdExCore.sol -o temp 
solc --overwrite --abi contracts/Identity.sol -o temp 
solc --overwrite --abi contracts/IdentityFactory.sol -o temp 
solc --overwrite --abi contracts/Staking.sol -o temp 
solc --overwrite --abi contracts/EarningOracle.sol -o temp 
mkdir -p resources abi
# AdexCore abi
mv temp/AdExCore.abi abi/AdExCore.json
mv temp/Identity.abi abi/Identity.json  
mv temp/IdentityFactory.abi abi/IdentityFactory.json
mv temp/Staking.abi abi/Staking.json
mv temp/EarningOracle.abi abi/EarningOracle.json
# AdexCore bytecode
bytecode="`cat temp/AdExCore.bin`"; # read file contents into var
echo "\"$bytecode\"" > "resources/bytecode/AdExCore.json" # write to file
rm -r temp/
