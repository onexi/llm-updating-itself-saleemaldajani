const execute = async (num1, num2) => {
    // Check if num2 is zero to prevent division by zero.
    if (num2 === 0) {
      throw new Error("Division by zero is not allowed");
    }
    // Return the result of dividing num1 by num2.
    return { result: num1 / num2 };
  };
  
  const details = {
    type: "function",
    function: {
      name: 'divideNumbers',
      parameters: {
        type: 'object',
        properties: {
          num1: {
            type: 'number',
            description: 'The dividend (number to be divided)'
          },
          num2: {
            type: 'number',
            description: 'The divisor (number to divide by)'
          }
        },
        required: ['num1', 'num2']
      },
    },
    description: 'This function divides two numbers and returns the result. It throws an error if an attempt is made to divide by zero.'
  };
  
  export { execute, details };
  