const execute = async (matrixA, matrixB) => {
    if (matrixA[0].length !== matrixB.length) {
        throw new Error('The number of columns in matrixA must be equal to the number of rows in matrixB');
    }
    const result = [];
    for (let i = 0; i < matrixA.length; i++) {
        result[i] = [];
        for (let j = 0; j < matrixB[0].length; j++) {
            let sum = 0;
            for (let k = 0; k < matrixA[0].length; k++) {
                sum += matrixA[i][k] * matrixB[k][j];
            }
            result[i][j] = sum;
        }
    }
    return { result };
};

const details = {
    type: "function",
    function: {
        name: 'matrixMultiply',
        parameters: {
            type: 'object',
            properties: {
                matrixA: {
                    type: 'array',
                    items: {
                        type: 'array',
                        items: {
                            type: 'number'
                        },
                        minItems: 1
                    },
                    description: 'The first matrix to multiply, represented as a 2D array'
                },
                matrixB: {
                    type: 'array',
                    items: {
                        type: 'array',
                        items: {
                            type: 'number'
                        },
                        minItems: 1
                    },
                    description: 'The second matrix to multiply, represented as a 2D array'
                }
            },
            required: ['matrixA', 'matrixB']
        },
    },
    description: 'This function multiplies two matrices and returns the resulting matrix.'
};

export { execute, details }