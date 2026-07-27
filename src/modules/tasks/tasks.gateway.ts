import { WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class TasksGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(TasksGateway.name);

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
    
    // Clients can join a room for a specific task to receive updates
    client.on('joinTask', (taskId: string) => {
      client.join(taskId);
      this.logger.log(`Client ${client.id} joined task ${taskId}`);
    });

    client.on('leaveTask', (taskId: string) => {
      client.leave(taskId);
      this.logger.log(`Client ${client.id} left task ${taskId}`);
    });
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  emitLogAdded(taskId: string, log: any) {
    this.server.to(taskId).emit('logAdded', log);
  }

  emitTaskUpdated(taskId: string, task: any) {
    this.server.to(taskId).emit('taskUpdated', task);
  }
}
