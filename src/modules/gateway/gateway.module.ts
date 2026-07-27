import { Module, Global } from '@nestjs/common';
import { TasksGateway } from '../tasks/tasks.gateway';

@Global()
@Module({
  providers: [TasksGateway],
  exports: [TasksGateway],
})
export class GatewayModule {}
