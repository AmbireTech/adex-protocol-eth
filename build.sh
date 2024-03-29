#!/usr/bin/env bash
set -e

change_bytecode_to_json_and_move () {
    cat_command="cat temp/$1.bin"
    bytecode="`$cat_command`"; # read file contents into var
    echo "\"$bytecode\"" > "resources/bytecode/$1.json" # write to file
}

mkdir -p temp

solc --overwrite --optimize --abi --bin contracts/OUTPACE.sol -o temp
solc --overwrite --optimize --allow-paths . --abi --bin contracts/deposits/Depositor.sol -o temp
solc --overwrite --optimize --allow-paths . --abi --bin contracts/deposits/Sweeper.sol -o temp
solc --overwrite --abi --bin contracts/Identity.sol -o temp
solc --overwrite --abi --allow-paths . contracts/wallet/QuickAccManager.sol -o temp
solc --overwrite --abi --allow-paths . contracts/wallet/RemainingBalancesOracle.sol -o temp
solc --overwrite --abi --allow-paths . contracts/wallet/Batcher.sol -o temp
solc --overwrite --abi contracts/IdentityFactory.sol -o temp 
solc --overwrite --abi contracts/StakingPool.sol -o temp 

# create dir if not exists
mkdir -p resources abi

# ABIs
mv temp/OUTPACE.abi abi/OUTPACE.json
mv temp/Identity.abi abi/Identity5.2.json
mv temp/IdentityFactory.abi abi/IdentityFactory5.2.json
mv temp/StakingPool.abi abi/StakingPool.json
mv temp/QuickAccManager.abi abi/QuickAccManager.json
mv temp/RemainingBalancesOracle.abi abi/RemainingBalancesOracle.json
mv temp/Batcher.abi abi/Batcher.json

# Identity bin file
#### we require this file for the Rust implementation
cp temp/Identity.bin resources/bytecode/Identity5.2.bin
# copy the Identity.bin to Identity5.2.bin because `change_bytecode_to_json_and_move`
cp temp/Identity.bin temp/Identity5.2.bin
change_bytecode_to_json_and_move "Identity5.2"

# Sweeper abi & bin file
mv temp/Sweeper.abi abi/Sweeper.json
#### we require this file for the Rust implementation
cp temp/Sweeper.bin resources/bytecode/Sweeper.bin
change_bytecode_to_json_and_move "Sweeper"

# Depositor abi & bin file
mv temp/Depositor.abi abi/Depositor.json
#### we require this file for the Rust implementation
cp temp/Depositor.bin resources/bytecode/Depositor.bin
change_bytecode_to_json_and_move "Depositor"

# OUTPACE bytecode
cp temp/OUTPACE.bin resources/bytecode/OUTPACE.bin
change_bytecode_to_json_and_move "OUTPACE"

# Remove the temp folder
rm -r temp/

