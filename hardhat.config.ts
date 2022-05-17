import * as dotenv from 'dotenv'

import { HardhatUserConfig } from 'hardhat/config'
import '@nomiclabs/hardhat-etherscan'
import '@nomiclabs/hardhat-waffle'
import '@typechain/hardhat'
import 'hardhat-gas-reporter'
import 'solidity-coverage'

const config: HardhatUserConfig = {
	solidity: {
		compilers: [
			{
				version: '0.5.16',
				settings: {
					optimizer: {
						enabled: true,
						runs: 200,
					},
				},
			},
			{
				version: '0.6.6',
				settings: {
					optimizer: {
						enabled: true,
						runs: 200,
					},
				},
			},
			{
				version: '0.8.13',
				settings: {
					optimizer: {
						enabled: true,
						runs: 200,
					},
				},
			},
		],
	},
	networks: {
		ropsten: {
			url: '',
			accounts: [],
		},
	},
	gasReporter: {
		enabled: process.env.REPORT_GAS !== undefined,
	},
	etherscan: {
		apiKey: '',
	},
}

export default config
