module.exports = {
    extends: ['airbnb-base', 'prettier'],
    plugins: ['prettier'],
    globals: {
        'artifacts': false,
        'contract': false,
        'assert': false,
        'web3': false,
        'before': false,
        'beforeEach': false,
        'it': false,
    },
    rules: {
      'prettier/prettier': ['error'],
      'func-names': 0,
      'no-underscore-dangle': 0,
      'no-use-before-define': 0,
      'prefer-destructuring': 0
    },
}; 
