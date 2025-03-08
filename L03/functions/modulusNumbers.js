const execute = async (num1, num2) => {
  return { result: num1 % num2 };
};

const details = {
  type: "function",
  function: {
    name: 'modulusNumbers',
    parameters: {
      type: 'object',
      properties: {
        num1: { type: 'number', description: 'The dividend in the modulus operation' },
        num2: { type: 'number', description: 'The divisor in the modulus operation' }
      },
      required: ['num1', 'num2']
    },
  },
  description: 'This function calculates the modulus (remainder) of two numbers and returns the result.'
};

export { execute, details }