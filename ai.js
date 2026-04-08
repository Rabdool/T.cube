require("dotenv").config();
// To run this code you need to install the following dependencies:
// npm install @google/genai mime
// npm install -D @types/node

const { GoogleGenerativeAI } = require("@google/generative-ai");

async function main() {
  const genAI = new GoogleGenerativeAI(process.env.AIzaSyBm4FSEuLg4xhdUOdORUp3FNygyEG3RPOU);
  const config = {
    thinkingConfig: {
      thinkingLevel: ThinkingLevel.HIGH,
    },
  };
  const model = 'gemini-3-flash-preview';
  const contents = [
    {
      role: 'user',
      parts: [
        {
          text: `INSERT_INPUT_HERE`,
        },
      ],
    },
  ];

  const response = await ai.models.generateContentStream({
    model,
    config,
    contents,
  });
  let fileIndex = 0;
  for await (const chunk of response) {
    if (chunk.text) {
      console.log(chunk.text);
    }
  }
}

main();

