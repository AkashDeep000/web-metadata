import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import puppeteer from "puppeteer-core"

const app = new Hono()
let browser; 
(async() => {
  browser = await puppeteer.launch({
       headless: true,
       product: "chromium",
       executablePath: '/nix/store/v099qxf96q4cm 47kskh9j146jfyh058i-chromium-108.0.5359. 94-sandbox/bin/__chromium-suid-sandbox',
       args: [
       "--no-sandbox",
       "--disable-gpu",
       ]
   });
 console.log("browser launched!")
})()

app.get('/', (c) => c.text('Hello Hono!'))

serve(app)
