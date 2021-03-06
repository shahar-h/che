/*
 * Copyright (c) 2018-2018 Red Hat, Inc.
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 *
 * Contributors:
 *   Red Hat, Inc. - initial API and implementation
 */
'use strict';
import {CheJsonRpcApiClient} from './che-json-rpc-api-service';
import { ICommunicationClient, CODE_REQUEST_TIMEOUT } from './json-rpc-client';

enum MasterChannels {
  ENVIRONMENT_OUTPUT = <any>'machine/log',
  ENVIRONMENT_STATUS = <any>'machine/statusChanged',
  WS_AGENT_OUTPUT = <any>'installer/log',
  WORKSPACE_STATUS = <any>'workspace/statusChanged'
}
const SUBSCRIBE: string = 'subscribe';
const UNSUBSCRIBE: string = 'unsubscribe';

/**
 * Client API for workspace master interactions.
 *
 * @author Ann Shumilova
 */
export class CheJsonRpcMasterApi {
  private cheJsonRpcApi: CheJsonRpcApiClient;
  private clientId: string;

  private checkingInterval: number;
  private checkingDelay = 10000;
  private fetchingClientIdTimeout = 5000;

  private client: ICommunicationClient;

  constructor(client: ICommunicationClient,
              entryPoint: string) {
    this.cheJsonRpcApi = new CheJsonRpcApiClient(client);
    this.client = client;

    client.addListener('open', () => this.onConnectionOpen());
    client.addListener('close', (event: any) => {
      switch (event.code) {
        case 1000: // normal close
          break;
        default:
          this.connect(entryPoint);
      }
    });
  }

  onConnectionOpen(): void {
    if (this.checkingInterval) {
      clearInterval(this.checkingInterval);
      this.checkingInterval = undefined;
    }

    this.checkingInterval = setInterval(() => {
      let isAlive = false;
      const fetchClientPromise = new Promise((resolve) => {
        this.fetchClientId().then(() => {
          isAlive = true;
          resolve(isAlive);
        }, () => {
          isAlive = false;
          resolve(isAlive);
        });
      });

      // this is timeout of fetchClientId request
      const fetchClientTimeoutPromise = new Promise((resolve) => {
        setTimeout(() => {
          resolve(isAlive);
        }, this.fetchingClientIdTimeout);
      });

      Promise.race([fetchClientPromise, fetchClientTimeoutPromise]).then((isAlive: boolean) => {
        if (isAlive) {
          return;
        }

        clearInterval(this.checkingInterval);
        this.checkingInterval = undefined;

        this.client.disconnect(CODE_REQUEST_TIMEOUT);
      });

    }, this.checkingDelay);
  }

  /**
   * Opens connection to pointed entryPoint.
   *
   * @param {string} entryPoint
   * @returns {IPromise<IHttpPromiseCallbackArg<any>>}
   */
  connect(entryPoint: string): Promise<any> {
    if (this.clientId) {
      let clientId = `clientId=${this.clientId}`;
      // in case of reconnection
      // we need to test entrypoint on existing query parameters
      // to add already gotten clientId
      if (/\?/.test(entryPoint) === false) {
        clientId = '?' + clientId;
      } else {
        clientId = '&' + clientId;
      }
      entryPoint += clientId;
    }
    return this.cheJsonRpcApi.connect(entryPoint).then(() => {
      return this.fetchClientId();
    }).catch((error: any) => {
      console.error(`Failed to connect to ${entryPoint}:`, error);
    });
  }

  /**
   * Subscribes the environment output.
   *
   * @param workspaceId workspace's id
   * @param machineName machine's name
   * @param callback callback to process event
   */
  subscribeEnvironmentOutput(workspaceId: string, callback: Function): void {
    this.subscribe(MasterChannels.ENVIRONMENT_OUTPUT, workspaceId, callback);
  }

  /**
   * Un-subscribes the pointed callback from the environment output.
   *
   * @param workspaceId workspace's id
   * @param machineName machine's name
   * @param callback callback to process event
   */
  unSubscribeEnvironmentOutput(workspaceId: string, callback: Function): void {
    this.unsubscribe(MasterChannels.ENVIRONMENT_OUTPUT, workspaceId, callback);
  }

  /**
   * Subscribes the environment status changed.
   *
   * @param workspaceId workspace's id
   * @param callback callback to process event
   */
  subscribeEnvironmentStatus(workspaceId: string, callback: Function): void {
    this.subscribe(MasterChannels.ENVIRONMENT_STATUS, workspaceId, callback);
  }

  /**
   * Un-subscribes the pointed callback from environment status changed.
   *
   * @param workspaceId workspace's id
   * @param callback callback to process event
   */
  unSubscribeEnvironmentStatus(workspaceId: string, callback: Function): void {
    this.unsubscribe(MasterChannels.ENVIRONMENT_STATUS, workspaceId, callback);
  }

  /**
   * Subscribes on workspace agent output.
   *
   * @param workspaceId workspace's id
   * @param callback callback to process event
   */
  subscribeWsAgentOutput(workspaceId: string, callback: Function): void {
    this.subscribe(MasterChannels.WS_AGENT_OUTPUT, workspaceId, callback);
  }

  /**
   * Un-subscribes from workspace agent output.
   *
   * @param workspaceId workspace's id
   * @param callback callback to process event
   */
  unSubscribeWsAgentOutput(workspaceId: string, callback: Function): void {
    this.unsubscribe(MasterChannels.WS_AGENT_OUTPUT, workspaceId, callback);
  }

  /**
   * Subscribes to workspace's status.
   *
   * @param workspaceId workspace's id
   * @param callback callback to process event
   */
  subscribeWorkspaceStatus(workspaceId: string, callback: Function): void {
    let statusHandler = (message: any) => {
      if (workspaceId === message.workspaceId) {
        callback(message);
      }
    };
    this.subscribe(MasterChannels.WORKSPACE_STATUS, workspaceId, statusHandler);
  }

  /**
   * Un-subscribes pointed callback from workspace's status.
   *
   * @param workspaceId
   * @param callback
   */
  unSubscribeWorkspaceStatus(workspaceId: string, callback: Function): void {
    this.unsubscribe(MasterChannels.WORKSPACE_STATUS, workspaceId, callback);
  }

  /**
   * Fetch client's id and stores it.
   *
   * @returns {IPromise<TResult>}
   */
  fetchClientId(): Promise<any> {
    return this.cheJsonRpcApi.request('websocketIdService/getId').then((data: any) => {
      this.clientId = data[0];
    });
  }

  /**
   * Returns client's id.
   *
   * @returns {string} clinet connection identifier
   */
  getClientId(): string {
    return this.clientId;
  }

  /**
   * Performs subscribe to the pointed channel for pointed workspace's ID and callback.
   *
   * @param channel channel to un-subscribe
   * @param workspaceId workspace's id
   * @param callback callback
   */
  private subscribe(channel: MasterChannels, workspaceId: string, callback: Function): void {
    let method: string = channel.toString();
    let params = {method: method, scope: {workspaceId: workspaceId}};
    this.cheJsonRpcApi.subscribe(SUBSCRIBE, method, callback, params);
  }

  /**
   * Performs un-subscribe of the pointed channel by pointed workspace's ID and callback.
   *
   * @param channel channel to un-subscribe
   * @param workspaceId workspace's id
   * @param callback callback
   */
  private unsubscribe(channel: MasterChannels, workspaceId: string, callback: Function): void {
    let method: string = channel.toString();
    let params = {method: method, scope: {workspaceId: workspaceId}};
    this.cheJsonRpcApi.unsubscribe(UNSUBSCRIBE, method, callback, params);
  }
}
