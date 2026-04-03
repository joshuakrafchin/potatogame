import { io } from 'socket.io-client';
import { SERVER_URL } from './constants';

let socket = null;

export function connectToServer() {
  if (socket) return socket;
  socket = io(SERVER_URL, {
    transports: ['websocket'],
    autoConnect: true,
  });
  return socket;
}

export function getSocket() {
  return socket;
}
