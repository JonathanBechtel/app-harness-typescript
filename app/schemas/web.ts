/** Response shape for server-rendered pages: an HTML document as a string. */

import { z } from 'zod';

export const HtmlPage = z.string();
