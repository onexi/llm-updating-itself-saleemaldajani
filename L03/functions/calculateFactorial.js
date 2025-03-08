const execute = async (num) => {
    // Calculate the factorial of the number
    const factorial = (n) => {
        if (n <= 1) return 1;
        return n * factorial(n - 1);
    };
    return { result: factorial(num) };
};

const details = {
    type: "function",
    function: {
        name: 'calculateFactorial',
        parameters: {
            type: 'object',
            properties: {
                num: {
                    type: 'number',
                    description: 'The number to take the factorial of'
                },
            },
            required: ['num']
        },
    },
    description: 'This function calculates the factorial of a given number and returns the result.'
};

export { execute, details }