import { Body, Controller, Get, HttpCode, Inject, Ip, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe.js';
import { DemoService } from './demo.service.js';

const ActBody = z.object({ as: z.string().min(1).max(32), action: z.enum(['release', 'open', 'remove-invigilator', 'submit-scripts']), params: z.record(z.string(), z.string()).optional() });
const LeakBody = z.object({ centre: z.enum(['A', 'B']).default('B') });

/** Judge mode (spec §8). DEMO keys, testnet only. /demo/start is rate-limited to 5 per hour per IP. */
@Controller('demo')
export class DemoController {
  constructor(@Inject(DemoService) private readonly demo: DemoService) {}

  @Post('start')
  start(@Ip() ip: string) {
    return this.demo.start(ip ?? 'unknown');
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.demo.get(id);
  }

  @Post(':id/act')
  @HttpCode(200)
  act(@Param('id') id: string, @Body(new ZodPipe(ActBody)) b: z.infer<typeof ActBody>) {
    return this.demo.act(id, b.as, b.action, b.params ?? {});
  }

  @Post(':id/leak')
  @HttpCode(200)
  leak(@Param('id') id: string, @Body(new ZodPipe(LeakBody)) b: z.infer<typeof LeakBody>) {
    return this.demo.leak(id, b.centre);
  }
}
