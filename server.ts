import express from 'express';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import fs from 'fs';
import path from 'path';

const app = express();
const PORT = 3000;

app.use(express.json());

// Load config
const configPath = path.join(process.cwd(), 'autoblog-config.json');
const autoblogConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

// Initialize Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

function fillTemplate(template: string, variables: Record<string, string>) {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, key) => variables[key] || '');
}

// Helper to clean JSON from markdown blocks
function cleanJson(str: string) {
  return str.replace(/^```json\n/, '').replace(/\n```$/, '').trim();
}

// SSE Endpoint for Pipeline Execution
app.get('/api/pipeline/stream', async (req, res) => {
  const topic = req.query.topic as string;
  
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (step: string, status: string, data?: any) => {
    res.write(`data: ${JSON.stringify({ step, status, data })}\n\n`);
  };

  if (!topic) {
    sendEvent('error', 'failed', { message: 'Topic is required' });
    res.end();
    return;
  }

  try {
    const steps = autoblogConfig.pipeline.steps;
    let context: Record<string, string> = { TOPIC: topic };
    let finalResult: any = {};

    // Step 1: Keyword Research
    sendEvent('keyword_research', 'running');
    const kwStep = steps.find((s: any) => s.id === 'keyword_research');
    const kwPrompt = fillTemplate(kwStep.user_prompt_template, context);
    
    const kwResponse = await ai.models.generateContent({
      model: 'gemini-3.1-pro-preview',
      contents: kwPrompt,
      config: {
        systemInstruction: kwStep.system_prompt,
        responseMimeType: 'application/json',
      }
    });
    
    const kwData = JSON.parse(cleanJson(kwResponse.text || '{}'));
    context['KEYWORD_RESEARCH_JSON'] = JSON.stringify(kwData, null, 2);
    context['PRIMARY_KEYWORD'] = kwData.primary_keyword;
    finalResult.keywords = kwData;
    sendEvent('keyword_research', 'completed', kwData);

    // Step 2: Outline
    sendEvent('content_outline', 'running');
    const outlineStep = steps.find((s: any) => s.id === 'content_outline');
    const outlinePrompt = fillTemplate(outlineStep.user_prompt_template, context);
    
    const outlineResponse = await ai.models.generateContent({
      model: 'gemini-3.1-pro-preview',
      contents: outlinePrompt,
      config: {
        systemInstruction: outlineStep.system_prompt,
        responseMimeType: 'application/json',
      }
    });
    
    const outlineData = JSON.parse(cleanJson(outlineResponse.text || '{}'));
    context['OUTLINE_JSON'] = JSON.stringify(outlineData, null, 2);
    context['POST_TITLE'] = outlineData.post_title;
    finalResult.outline = outlineData;
    sendEvent('content_outline', 'completed', outlineData);

    // Step 3: Draft
    sendEvent('content_draft', 'running');
    const draftStep = steps.find((s: any) => s.id === 'content_draft');
    const draftPrompt = fillTemplate(draftStep.user_prompt_template, context);
    
    const draftResponse = await ai.models.generateContent({
      model: 'gemini-3.1-pro-preview',
      contents: draftPrompt,
      config: {
        systemInstruction: draftStep.system_prompt,
      }
    });
    
    let draftHtml = draftResponse.text || '';
    // Clean markdown html blocks if present
    draftHtml = draftHtml.replace(/^```html\n/, '').replace(/\n```$/, '').trim();
    context['ARTICLE_EXCERPT'] = draftHtml.substring(0, 500);
    finalResult.draft = draftHtml;
    sendEvent('content_draft', 'completed', { html: draftHtml });

    // Step 4: Featured Image (Mocked for speed, using picsum)
    sendEvent('featured_image', 'running');
    await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate delay
    const imageUrl = `https://picsum.photos/seed/${encodeURIComponent(topic)}/1792/1024`;
    finalResult.image = imageUrl;
    sendEvent('featured_image', 'completed', { url: imageUrl });

    // Step 5: SEO Meta
    sendEvent('seo_meta', 'running');
    const seoStep = steps.find((s: any) => s.id === 'seo_meta');
    const seoPrompt = fillTemplate(seoStep.user_prompt_template, context);
    
    const seoResponse = await ai.models.generateContent({
      model: 'gemini-3.1-pro-preview',
      contents: seoPrompt,
      config: {
        systemInstruction: seoStep.system_prompt,
        responseMimeType: 'application/json',
      }
    });
    
    const seoData = JSON.parse(cleanJson(seoResponse.text || '{}'));
    finalResult.seo = seoData;
    sendEvent('seo_meta', 'completed', seoData);

    // Finalize
    sendEvent('pipeline', 'finished', finalResult);
    res.end();

  } catch (error: any) {
    console.error('Pipeline Error:', error);
    sendEvent('error', 'failed', { message: error.message });
    res.end();
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
