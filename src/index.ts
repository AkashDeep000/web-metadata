import { serve } from "@hono/node-server";
import { Hono } from "hono";
import "dotenv/config";
import { bearerAuth } from "hono/bearer-auth";
import puppeteer from "puppeteer-core";
import cheerio from "cheerio";
import OpenAI from "openai";
import { NodeHtmlMarkdown } from "node-html-markdown";
import DOMPurify from "isomorphic-dompurify";
import ogFields from "./utils/ogFields";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
const app = new Hono();

app.get("/", async (c) => {
  const urlInput = c.req.query("url");
  const url = `${
    urlInput?.startsWith("http://") || urlInput?.startsWith("https://")
      ? ""
      : "http://"
  }${urlInput}`;
  if (!isValidUrl(url)) {
    return c.json({ error: true, messages: "Provide a valid url param" }, 400);
  }
  let browser = null;
  try {
    browser = await puppeteer.connect({
      browserWSEndpoint: `wss://chrome.browserless.io?token=${process.env.BROWSERLESS_KEY}&stealth`,
    });
    const page = await browser.newPage();
    const response = await page.goto(url, {
      waitUntil: "networkidle0",
      timeout: 10000,
    });
    const html = await page.evaluate(
      () => document.querySelector("*").outerHTML
    );
    const chain = response.request().redirectChain();
    const finalUrl = chain[chain.length - 1]?.url() || url;

    const metadata = getMetadata({ html, url, finalUrl });
    const cleanHtml = DOMPurify.sanitize(html, {
      ALLOWED_TAGS: [
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "p",
        "b",
        "span",
        "div",
        "button",
        "link",
        "ul",
        "ol",
        "li",
        "dl",
        "dt",
        "dd",
        "table",
        "th",
        "tr",
        "td",
        "caption",
        "colgroup",
        "col",
        "thead",
        "tbody",
        "tfoot",
        "details",
        "small",
        "q",
        "em",
      ],
    });
    const contentMarkdown = NodeHtmlMarkdown.translate(cleanHtml);
    //console.log(contentMarkdown);
    const truncatedString = truncateStringToTokenCount(contentMarkdown, 3500);

    const prompt = [
      { role: "system", content: "You are a helpful assistant" },
      {
        role: "user",
        content:
          "Can you help to create a 2 or 3 line seo description of the following website and identify only most relavent catagories for the website?",
      },
      {
        role: "user",
        content:
          "Return the response in json format with two fields: summary and catagories",
      },
      {
        role: "user",
        content: "The website's content is formatted as markdown.",
      },
      {
        role: "user",
        content: `The title of the website is ${metadata.title || metadata.ogTitle || ""} ${
          metadata.description || metadata.ogDescription || ""
        }.`,
      },
      {
        role: "user",
        content: `The article is as follows: \n${truncatedString}`,
      },
    ];

    const chatInput = {
      model: "gpt-3.5-turbo",
      messages: prompt,
      temperature: 0.4,
    };
    
    const completion = await openai.chat.completions.create(chatInput);
    console.log(completion);
    const gptRes = JSON.parse(completion.choices[0].message.content);
    return c.json({ ...metadata, ...gptRes });
  } catch (error) {
    console.log(error)
    return c.json({ error: true, message: error.error.message }, 400);
  } finally {
    if (browser) {
      browser.close();
    }
  }
});

const getMetadata = ({ html, url, finalUrl }) => {
  const urlObj = new URL(url);
  const finalUrlObj = new URL(finalUrl);
  const $ = cheerio.load(html);
  const metadata = {};
  //extract title
  const title = $("title").text().trim();
  metadata["title"] = title;
  //extract favicon
  $("link").each((index, link) => {
    //console.log(link.attribs);
    if (link.attribs.rel == "icon" || link.attribs.rel == "shortcut icon") {
      let favicon = link.attribs.href.startsWith("//")
        ? link.attribs.href.substring(2)
        : link.attribs.href;

      if (!isValidUrl(favicon)) {
        favicon = `${finalUrlObj.origin}${favicon}`;
      }
      metadata["favicon"] = favicon;
    }
  });

  if (!metadata.favicon) {
    metadata["favicon"] = `${finalUrlObj.origin}/favicon.ico`;
  }

  //get meta tags
  $("meta").each((index, meta) => {
    if (!meta.attribs || (!meta.attribs.property && !meta.attribs.name)) return;
    const property = meta.attribs.property || meta.attribs.name;
    const content = meta.attribs.content || meta.attribs.value;

    //find ogFields
    ogFields.forEach((e) => {
      if (property.toLowerCase() === e.property.toLowerCase()) {
        if (e.multiple) {
          metadata[e.fieldName] = [content];
        } else {
          metadata[e.fieldName] = content;
        }
      }
    });
  });
  return metadata;
};

// function that takes a string and truncates it to a word boundary of given word count
const truncateStringToTokenCount = (str, num) => {
  return str.split(/\s+/).slice(0, num).join(" ");
};

const isValidUrl = (url) => {
  const urlPattern = new RegExp(
    "^(https?:\\/\\/)?" + // validate protocol
      "((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.)+[a-z]{2,}|" + // validate domain name
      "((\\d{1,3}\\.){3}\\d{1,3}))" + // validate OR ip (v4) address
      "(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*" + // validate port and path
      "(\\?[;&a-z\\d%_.~+=-]*)?",
    "i"
  );
  return !!urlPattern.test(url);
};

serve(app);
