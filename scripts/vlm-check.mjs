import ZAI from 'z-ai-web-dev-sdk';
import fs from 'fs';

const imgB64 = fs.readFileSync('/home/z/my-project/download/v16-strategic-roadmap.png').toString('base64');

const zai = await ZAI.create();
const res = await zai.chat.completions.create({
  model: 'glm-4.6v',
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Describe what you see in this dashboard screenshot in 4-6 sentences. Focus on: (1) what tab is active, (2) what categories/capabilities are shown, (3) any progress bars or status badges visible, (4) overall layout quality.' },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${imgB64}` } }
      ]
    }
  ]
});
console.log(res.choices[0].message.content);
