module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended'
  ],
  env: {
    node: true,
    es2022: true
  },
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    '@typescript-eslint/no-namespace': 'off',
    // INC-0304 Defence in depth rule:
    // Forbid importing internal notes repository in customer-facing routes or DTOs
    'no-restricted-imports': [
      'error',
      {
        paths: [
          {
            name: '../domain/notesRepo',
            message: 'SECURITY: Internal notes repository must never be imported in customer portal routes or DTOs (INC-0304).'
          },
          {
            name: '../../domain/notesRepo',
            message: 'SECURITY: Internal notes repository must never be imported in customer portal routes or DTOs (INC-0304).'
          }
        ]
      }
    ]
  },
  overrides: [
    {
      files: ['src/http/routes/portal.ts', 'src/http/dto.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['*notesRepo*'],
                message: 'SECURITY: Notes repo is strictly forbidden in portal / DTO files (INC-0304).'
              }
            ]
          }
        ]
      }
    }
  ]
};
