import express from 'express';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Load config
const configPath = path.join(process.cwd(), 'autoblog-config.json');
const autoblogConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

function fillTemplate(template: string, variables: Record<string, string>) {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, key) => variables[key] || '');
}

// Helper to clean JSON from markdown blocks
function cleanJson(str: string) {
  return str.replace(/^```json\n/, '').replace(/\n```$/, '').trim();
}

async function generateText(options: {
  provider: string;
  model: string;
  apiKey: string;
  prompt: string;
  systemInstruction?: string;
  isJson?: boolean;
}) {
  try {
    if (options.provider === 'openai') {
      const openai = new OpenAI({ apiKey: options.apiKey });
      const messages: any[] = [];
      if (options.systemInstruction) {
        messages.push({ role: 'system', content: options.systemInstruction });
      }
      messages.push({ role: 'user', content: options.prompt });

      const response = await openai.chat.completions.create({
        model: options.model,
        messages: messages,
        response_format: options.isJson ? { type: 'json_object' } : undefined,
      });
      return response.choices[0].message.content || '';
    } else {
      const ai = new GoogleGenAI({ apiKey: options.apiKey });
      const response = await ai.models.generateContent({
        model: options.model,
        contents: options.prompt,
        config: {
          systemInstruction: options.systemInstruction,
          responseMimeType: options.isJson ? 'application/json' : undefined,
        }
      });
      return response.text || '';
    }
  } catch (error: any) {
    if (error?.status === 429 || error?.message?.includes('429') || error?.message?.includes('quota') || error?.message?.includes('RESOURCE_EXHAUSTED')) {
      throw new Error(`Rate limit or quota exceeded for ${options.provider} model ${options.model}. Please check your API plan/billing details or switch to a different model.`);
    }
    throw error;
  }
}

async function generateImage(options: {
  provider: string;
  model: string;
  apiKey: string;
  prompt: string;
}) {
  try {
    if (options.provider === 'openai') {
      const openai = new OpenAI({ apiKey: options.apiKey });
      const response = await openai.images.generate({
        model: options.model || 'dall-e-3',
        prompt: options.prompt,
        n: 1,
        size: '1024x1024',
        response_format: 'b64_json'
      });
      return `data:image/png;base64,${response.data[0].b64_json}`;
    } else {
      const ai = new GoogleGenAI({ apiKey: options.apiKey });
      const uniquePrompt = `${options.prompt} [Unique seed: ${Date.now()}-${Math.random().toString(36).substring(7)}]`;
      const isAdvancedModel = options.model?.includes('3.1') || options.model?.includes('3-pro');
      const response = await ai.models.generateContent({
        model: options.model || 'gemini-3.1-flash-image-preview',
        contents: uniquePrompt,
        config: {
          imageConfig: {
            aspectRatio: "16:9",
            ...(isAdvancedModel ? { imageSize: "1K" } : {})
          }
        }
      });
      
      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
        }
      }
      throw new Error("No image generated");
    }
  } catch (error: any) {
    if (error?.status === 429 || error?.message?.includes('429') || error?.message?.includes('quota') || error?.message?.includes('RESOURCE_EXHAUSTED')) {
      throw new Error(`Rate limit or quota exceeded for ${options.provider} image model ${options.model}. Please check your API plan/billing details or switch to a different model.`);
    }
    throw error;
  }
}

// Models Endpoint
app.post('/api/models', async (req, res) => {
  const { provider, apiKey: clientKey } = req.body;
  const apiKey = clientKey || process.env.API_KEY || process.env.GEMINI_API_KEY || '';
  try {
    if (!apiKey) {
      return res.json({ models: [] });
    }
    if (provider === 'openai') {
      const openai = new OpenAI({ apiKey });
      const models = await openai.models.list();
      const chatModels = models.data
        .filter(m => m.id.startsWith('gpt'))
        .map(m => m.id)
        .sort();
      res.json({ models: chatModels });
    } else if (provider === 'gemini') {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
      const data = await response.json();
      if (data.models) {
        const modelNames = data.models
          .filter((m: any) => m.name.includes('gemini'))
          .map((m: any) => m.name.replace('models/', ''))
          .sort();
        res.json({ models: modelNames });
      } else {
        res.json({ models: ['gemini-3.1-flash-preview', 'gemini-3.1-pro-preview', 'gemini-2.5-flash', 'gemini-2.5-pro'] });
      }
    } else {
      res.json({ models: [] });
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Topic Generation Endpoint
app.get('/api/topics/generate', async (req, res) => {
  try {
    const provider = (req.query.provider as string) || 'gemini';
    const model = (req.query.model as string) || 'gemini-3.1-flash-preview';
    const clientKey = req.query.apiKey as string;
    const apiKey = clientKey || process.env.API_KEY || process.env.GEMINI_API_KEY || '';
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
      throw new Error('API Key is not set.');
    }
    const currentYear = new Date().getFullYear();
    
    const prompt = `You are an expert SEO strategist for a Nigerian WordPress web design and development agency. The current year is ${currentYear}. 
    Research and generate 5 trending, highly relevant, long-tail keyword topics for blog posts. 
    Focus exclusively on WordPress-related topics that Nigerian businesses, SMEs, and startups are searching for right now in ${currentYear} (e.g., WooCommerce, WordPress security, WordPress speed optimization, custom WordPress design, etc.). 
    Do not use outdated years like 2024 or 2025.
    Return ONLY a JSON array of 5 strings, where each string is a compelling blog post title/topic.`;

    const responseText = await generateText({
      provider,
      model,
      apiKey,
      prompt,
      isJson: true,
    });

    const topics = JSON.parse(cleanJson(responseText || '[]'));
    res.json({ topics });
  } catch (error: any) {
    console.error('Topic Generation Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// SSE Endpoint for Pipeline Execution
app.get('/api/pipeline/stream', async (req, res) => {
  const topic = req.query.topic as string;
  const provider = (req.query.provider as string) || 'gemini';
  const textModel = (req.query.textModel as string) || 'gemini-3.1-flash-preview';
  const imageModel = (req.query.imageModel as string) || 'gemini-3.1-flash-image-preview';
  const clientKey = req.query.apiKey as string;
  
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
    const apiKey = clientKey || process.env.API_KEY || process.env.GEMINI_API_KEY || '';
    console.log(`Initializing ${provider} with API key of length: ${apiKey.length}`);
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
      throw new Error('API Key is not set. Please select an API key or add it in the Settings tab.');
    }

    const currentYear = new Date().getFullYear();
    const yearRule = `\n\nCRITICAL RULE: The current year is ${currentYear}. All content, statistics, and references must be strictly up-to-date for ${currentYear}. Do NOT use 2024 or 2025.`;

    const steps = autoblogConfig.pipeline.steps;
    let context: Record<string, string> = { TOPIC: topic };
    let finalResult: any = {};

    // Step 1: Keyword Research
    sendEvent('keyword_research', 'running');
    const kwStep = steps.find((s: any) => s.id === 'keyword_research');
    const kwPrompt = fillTemplate(kwStep.user_prompt_template, context);
    
    const kwResponseText = await generateText({
      provider,
      model: textModel,
      apiKey,
      prompt: kwPrompt,
      systemInstruction: kwStep.system_prompt + yearRule,
      isJson: true,
    });
    
    const kwData = JSON.parse(cleanJson(kwResponseText || '{}'));
    context['KEYWORD_RESEARCH_JSON'] = JSON.stringify(kwData, null, 2);
    context['PRIMARY_KEYWORD'] = kwData.primary_keyword;
    finalResult.keywords = kwData;
    sendEvent('keyword_research', 'completed', kwData);

    // Step 2: Outline
    sendEvent('content_outline', 'running');
    const outlineStep = steps.find((s: any) => s.id === 'content_outline');
    const outlinePrompt = fillTemplate(outlineStep.user_prompt_template, context);
    
    const outlineResponseText = await generateText({
      provider,
      model: textModel,
      apiKey,
      prompt: outlinePrompt,
      systemInstruction: outlineStep.system_prompt + yearRule,
      isJson: true,
    });
    
    const outlineData = JSON.parse(cleanJson(outlineResponseText || '{}'));
    context['OUTLINE_JSON'] = JSON.stringify(outlineData, null, 2);
    context['POST_TITLE'] = outlineData.post_title;
    finalResult.outline = outlineData;
    sendEvent('content_outline', 'completed', outlineData);

    // Step 3: Draft
    sendEvent('content_draft', 'running');
    const draftStep = steps.find((s: any) => s.id === 'content_draft');
    const draftPrompt = fillTemplate(draftStep.user_prompt_template, context);
    
    const draftResponseText = await generateText({
      provider,
      model: textModel,
      apiKey,
      prompt: draftPrompt,
      systemInstruction: draftStep.system_prompt + yearRule,
      isJson: false,
    });
    
    let draftHtml = draftResponseText || '';
    // Clean markdown html blocks if present
    draftHtml = draftHtml.replace(/^```html\n/, '').replace(/\n```$/, '').trim();
    context['ARTICLE_EXCERPT'] = draftHtml.substring(0, 500);
    finalResult.draft = draftHtml;
    sendEvent('content_draft', 'completed', { html: draftHtml });

    // Step 4: Featured Image
    sendEvent('featured_image', 'running');
    const imageStep = steps.find((s: any) => s.id === 'featured_image');
    if (imageStep) {
      try {
        const imagePromptTemplate = fillTemplate(imageStep.user_prompt_template, context);
        
        // First get the prompt from the text model
        const promptResponseText = await generateText({
          provider,
          model: textModel,
          apiKey,
          prompt: imagePromptTemplate,
          systemInstruction: imageStep.system_prompt + yearRule,
          isJson: true,
        });
        
        const promptData = JSON.parse(cleanJson(promptResponseText || '{}'));
        const finalImagePrompt = promptData.image_prompt || `A professional, high-quality blog featured image for a Nigerian web design agency. Topic: ${topic}. Style: modern, corporate, vibrant, African business context.`;

        // Then generate the image
        let base64Image;
        try {
          base64Image = await generateImage({
            provider,
            model: imageModel,
            apiKey,
            prompt: finalImagePrompt,
          });
          
          if (!base64Image) {
            throw new Error("No image generated");
          }
        } catch (e: any) {
          console.error("Image generation failed:", e.message);
          // Fallback: Fetch a relevant image from Unsplash/Picsum and convert to base64
          const seed = encodeURIComponent(topic.replace(/\s+/g, '-').toLowerCase() + '-' + Date.now());
          const fallbackUrl = `https://picsum.photos/seed/${seed}/1200/800`;
          const imgRes = await fetch(fallbackUrl);
          const arrayBuffer = await imgRes.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          base64Image = `data:image/jpeg;base64,${buffer.toString('base64')}`;
        }
        
        finalResult.image = base64Image;
        sendEvent('featured_image', 'completed', { url: base64Image });
      } catch (e: any) {
        console.error("Featured image step failed:", e.message);
        // Ultimate fallback
        const seed = Date.now().toString();
        const fallbackUrl = `https://picsum.photos/seed/${seed}/1200/800`;
        const imgRes = await fetch(fallbackUrl);
        const arrayBuffer = await imgRes.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const base64Image = `data:image/jpeg;base64,${buffer.toString('base64')}`;
        finalResult.image = base64Image;
        sendEvent('featured_image', 'completed', { url: base64Image });
      }
    } else {
      const seed = Date.now().toString();
      const fallbackUrl = `https://picsum.photos/seed/${seed}/1200/800`;
      const imgRes = await fetch(fallbackUrl);
      const arrayBuffer = await imgRes.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const base64Image = `data:image/jpeg;base64,${buffer.toString('base64')}`;
      finalResult.image = base64Image;
      sendEvent('featured_image', 'completed', { url: base64Image });
    }

    // Step 5: SEO Meta
    sendEvent('seo_meta', 'running');
    const seoStep = steps.find((s: any) => s.id === 'seo_meta');
    const seoPrompt = fillTemplate(seoStep.user_prompt_template, context);
    
    const seoResponseText = await generateText({
      provider,
      model: textModel,
      apiKey,
      prompt: seoPrompt,
      systemInstruction: seoStep.system_prompt + yearRule,
      isJson: true,
    });
    
    const seoData = JSON.parse(cleanJson(seoResponseText || '{}'));
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

// WP Publish Endpoint
app.post('/api/publish', express.json({limit: '50mb'}), async (req, res) => {
  const { title, content, wpUrl, wpUser, wpPassword, imageBase64 } = req.body;
  
  if (!wpUrl || !wpUser || !wpPassword) {
    return res.status(400).json({ error: 'Missing WordPress credentials' });
  }
  
  try {
    const cleanUrl = wpUrl.replace(/\/$/, '');
    const auth = Buffer.from(`${wpUser}:${wpPassword}`).toString('base64');
    
    let featuredMediaId = null;

    // Upload image if provided
    if (imageBase64) {
      try {
        // Extract mime type and base64 data
        const matches = imageBase64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        if (matches && matches.length === 3) {
          const mimeType = matches[1];
          const imageData = Buffer.from(matches[2], 'base64');
          const extension = mimeType.split('/')[1] || 'jpg';
          const filename = `featured-image-${Date.now()}.${extension}`;

          const mediaResponse = await fetch(`${cleanUrl}/wp-json/wp/v2/media`, {
            method: 'POST',
            headers: {
              'Authorization': `Basic ${auth}`,
              'Content-Type': mimeType,
              'Content-Disposition': `attachment; filename="${filename}"`
            },
            body: imageData
          });

          if (mediaResponse.ok) {
            const mediaData = await mediaResponse.json();
            featuredMediaId = mediaData.id;
          } else {
            console.warn('Failed to upload media:', await mediaResponse.text());
          }
        }
      } catch (imgErr) {
        console.warn('Error uploading image:', imgErr);
      }
    }
    
    const postBody: any = {
      title: title,
      content: content,
      status: 'draft', // Publishing as draft for safety
    };

    if (featuredMediaId) {
      postBody.featured_media = featuredMediaId;
    }

    const response = await fetch(`${cleanUrl}/wp-json/wp/v2/posts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${auth}`
      },
      body: JSON.stringify(postBody)
    });
    
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`WP API Error: ${response.status} ${err}`);
    }
    
    const data = await response.json();
    res.json({ success: true, url: data.link });
  } catch (error: any) {
    console.error('Publish Error:', error);
    res.status(500).json({ error: error.message });
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
