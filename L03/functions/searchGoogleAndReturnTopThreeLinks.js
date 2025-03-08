const execute = async (query) => {
  // Imagine this is a call to a Google Search API that returns search results
  const searchResults = await searchGoogleApi(query);
  const topThreeLinks = searchResults.items.slice(0, 3).map(item => item.link);
  return { links: topThreeLinks };
};

const details = {
  type: "function",
  function: {
    name: 'searchGoogleAndReturnTopThreeLinks',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query to use on Google' }
      },
      required: ['query']
    },
  },
  description: 'This function searches Google with the provided query and returns the top three search result links.'
};

export { execute, details }