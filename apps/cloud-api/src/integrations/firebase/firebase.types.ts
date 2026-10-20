export interface FcmNotificationPayload {
  title: string;
  body: string;
}

export interface FcmMessage {
  token: string;
  notification: FcmNotificationPayload;
  data?: Record<string, string> | undefined;
}

export interface FcmSendResult {
  success: boolean;
  messageId?: string | undefined;
  errorCode?: string | undefined;
  errorMessage?: string | undefined;
}

export interface IFirebaseClient {
  send(message: FcmMessage): Promise<FcmSendResult>;
  sendMulticast?(messages: FcmMessage[]): Promise<FcmSendResult[]>;
}
