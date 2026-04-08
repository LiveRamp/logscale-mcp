# LogScale Repo Keys (Sampled)

This document captures sample keys per LogScale `#repo` to help agents form
queries. Keys are derived from a 1-hour sample window using the MCP query
`#repo=<name> | head(1)` unless noted (no values included).

## Repo Inventory (1h)

Sampled with: `* | top(#repo, limit=100)` (24 hours)

- `gcp_cloudaudit`
- `netskope_api`
- `fltr-crowdstrike_data`
- `netskope_webtx`
- `paloalto_firewall`
- `cloudtrail`
- `proofpoint_ondemand`
- `github_audit`
- `securityhub`
- `singlestore`
- `snowflake`
- `gcp_scc`
- `okta_corp`
- `okta_customer`
- `macie`
- `switches`
- `gmail`
- `windows_events`
- `google_workspace`
- `proofpoint_tap`
- `one_password`

## gcp_cloudaudit

Query: `#repo=gcp_cloudaudit | head(1)`

Top-level keys:
- `insertId`
- `labels`
- `logName`
- `operation`
- `protoPayload`
- `receiveTimestamp`
- `resource`
- `timestamp`
- `seceng_pipeline_time`

Nested keys:
- `labels.authorization.k8s.io/decision`
- `labels.authorization.k8s.io/reason`
- `operation.first`
- `operation.id`
- `operation.producer`
- `protoPayload.@type`
- `protoPayload.authenticationInfo.principalEmail`
- `protoPayload.authorizationInfo[].granted`
- `protoPayload.authorizationInfo[].permission`
- `protoPayload.authorizationInfo[].resource`
- `protoPayload.methodName`
- `protoPayload.requestMetadata.callerIp`
- `protoPayload.requestMetadata.callerSuppliedUserAgent`
- `protoPayload.resourceName`
- `protoPayload.serviceName`
- `protoPayload.status`
- `resource.labels.cluster_name`
- `resource.labels.location`
- `resource.labels.project_id`
- `resource.type`

## netskope_api

Query: `#repo=netskope_api | head(1)`

Top-level keys:
- `_category_id`
- `_correlation_id`
- `_creation_timestamp`
- `_ctg`
- `_ef_received_at`
- `_enriched_all`
- `_event_id`
- `_forwarded_by`
- `_gef_src_dp`
- `_id`
- `_ingress_client_bytes`
- `_ingress_server_bytes`
- `_insertion_epoch_timestamp`
- `_nshostname`
- `_raw_event_inserted_at`
- `_service_identifier`
- `_skip_geoip_lookup`
- `_src_epoch_now`
- `_src_gmt_offset`
- `access_method`
- `app`
- `app_session_id`
- `app_tags`
- `appcategory`
- `browser`
- `browser_session_id`
- `browser_version`
- `bypass_traffic`
- `category`
- `cci`
- `ccl`
- `client_bytes`
- `conn_duration`
- `conn_endtime`
- `conn_starttime`
- `connection_id`
- `count`
- `device`
- `domain`
- `dst_country`
- `dst_latitude`
- `dst_location`
- `dst_longitude`
- `dst_region`
- `dst_timezone`
- `dst_zipcode`
- `dstip`
- `dstport`
- `hostname`
- `http_transaction_count`
- `netskope_pop`
- `numbytes`
- `organization_unit`
- `os`
- `os_family`
- `os_version`
- `other_categories`
- `page`
- `protocol`
- `req_cnt`
- `resp_cnt`
- `server_bytes`
- `severity`
- `site`
- `src_country`
- `src_latitude`
- `src_location`
- `src_longitude`
- `src_region`
- `src_time`
- `src_timezone`
- `src_zipcode`
- `srcip`
- `timestamp`
- `traffic_type`
- `type`
- `ur_normalized`
- `url`
- `user`
- `user_generated`
- `useragent`
- `userip`
- `userkey`
- `seceng_pipeline_time`

## fltr-crowdstrike_data

Query: `#repo=fltr-crowdstrike_data | head(1)`

Top-level keys:
- `ASEPFilePath`
- `AuthenticationId`
- `CodeSigningFlags`
- `CommandLine`
- `ComputerName`
- `ConfigBuild`
- `ConfigStateHash`
- `EffectiveTransmissionClass`
- `Entitlements`
- `EnvironmentVariablesString`
- `EventOrigin`
- `GID`
- `ImageFileName`
- `LocalAddressIP4`
- `MD5HashData`
- `MachOSubType`
- `ParentBaseFileName`
- `ParentProcessId`
- `ProcessEndTime`
- `ProcessGroupId`
- `ProcessStartTime`
- `RGID`
- `RUID`
- `RawProcessId`
- `ResponsiblePid`
- `SHA1HashData`
- `SHA256HashData`
- `SVGID`
- `SVUID`
- `SessionProcessId`
- `SigningId`
- `SourceProcessId`
- `SourceThreadId`
- `SubmittedByPid`
- `Tags`
- `TargetProcessId`
- `TeamId`
- `UID`
- `UserName`
- `aid`
- `aip`
- `cid`
- `event_platform`
- `event_simpleName`
- `id`
- `name`
- `timestamp`
- `seceng_pipeline_time`

## netskope_webtx

Query: `#repo=netskope_webtx | head(1)`

Notes:
- The query response returned a raw CSV line without JSON keys.
- This repo uses a structured CSV schema; keys depend on the parser column map.
- Action item: export the Netskope WebTx parser column list so
  `parseCsv(columns=[...])` can expand fields for accurate keys.

## paloalto_firewall

Query: `#repo=paloalto_firewall | head(1)`

Top-level keys:
- `host`
- `ident`
- `message`
- `seceng_pipeline_time`

Notes:
- `message` contains the full raw PAN-OS traffic log line. If parsed fields
  are required, the parser/format needs to be applied in the query.

## cloudtrail

Query: `#repo=cloudtrail | head(1)`

Top-level keys:
- `eventVersion`
- `userIdentity`
- `eventTime`
- `eventSource`
- `eventName`
- `awsRegion`
- `sourceIPAddress`
- `userAgent`
- `requestParameters`
- `responseElements`
- `additionalEventData`
- `requestID`
- `eventID`
- `readOnly`
- `resources`
- `eventType`
- `managementEvent`
- `recipientAccountId`
- `sharedEventID`
- `eventCategory`
- `seceng_pipeline_time`

Nested keys:
- `userIdentity.type`
- `userIdentity.invokedBy`
- `requestParameters.roleArn`
- `requestParameters.roleSessionName`
- `responseElements.credentials.accessKeyId`
- `responseElements.credentials.sessionToken`
- `responseElements.credentials.expiration`
- `responseElements.assumedRoleUser.assumedRoleId`
- `responseElements.assumedRoleUser.arn`
- `additionalEventData.ExtendedRequestId`
- `resources[].accountId`
- `resources[].type`
- `resources[].ARN`

## proofpoint_ondemand

Query: `#repo=proofpoint_ondemand | head(1)`

Top-level keys:
- `sm`
- `metadata`
- `tls`
- `id`
- `ts`
- `pps`
- `data`
- `seceng_pipeline_time`

Nested keys:
- `sm.pri`
- `sm.xdelay`
- `sm.mailer`
- `sm.stat`
- `sm.dsn`
- `sm.qid`
- `sm.delay`
- `sm.guid`
- `sm.relay`
- `sm.to[]`
- `sm.messageTs`
- `metadata.customerId`
- `metadata.origin.data.agent`
- `metadata.origin.data.theater`
- `metadata.origin.data.cid`
- `metadata.origin.schemaVersion`
- `tls.cipher`
- `tls.verify`
- `tls.version`
- `pps.agent`
- `pps.theater`
- `pps.cid`

## github_audit

Query: `#repo=github_audit | head(1)`

Top-level keys:
- `@timestamp`
- `_document_id`
- `action`
- `actor`
- `actor_id`
- `actor_location`
- `business`
- `business_id`
- `hashed_token`
- `org`
- `org_id`
- `programmatic_access_type`
- `repo`
- `repository`
- `repository_id`
- `repository_public`
- `request_access_security_header`
- `request_id`
- `token_id`
- `transport_protocol`
- `transport_protocol_name`
- `user`
- `user_agent`
- `user_id`
- `seceng_pipeline_time`

Nested keys:
- `actor_location.country_code`

## securityhub

Query: `#repo=securityhub | head(1)`

Top-level keys:
- `version`
- `id`
- `source`
- `account`
- `time`
- `region`
- `resources[]`
- `detail`
- `detailType`
- `seceng_pipeline_time`

Notes:
- `detail.findings[]` follows the AWS Security Hub finding schema and contains
  nested keys for compliance, resources, remediation, severity, workflow, etc.

## singlestore

Query: `#repo=singlestore | head(1)`

Top-level keys:
- `log_entry_id`
- `timestamp`
- `time_zone`
- `hostname`
- `port`
- `node_type`
- `thread_id`
- `username`
- `remote_host`
- `user_grant`
- `auth_type`
- `success_or_failure`
- `reason`
- `cluster_id`
- `event_type`
- `seceng_pipeline_time`

## snowflake

Query: `#repo=snowflake | head(1)`

Top-level keys:
- `message`
- `message_type`
- `task`
- `timestamp`
- `seceng_pipeline_time`

## gcp_scc

Query: `#repo=gcp_scc | head(1)`

Top-level keys:
- `notificationConfigName`
- `finding`
- `resource`
- `seceng_pipeline_time`

Notes:
- `finding.*` and `resource.*` contain nested SCC finding and asset metadata.

## okta_corp

Query: `#repo=okta_corp | head(1)`

Top-level keys:
- `actor`
- `client`
- `device`
- `authenticationContext`
- `displayMessage`
- `eventType`
- `outcome`
- `published`
- `securityContext`
- `severity`
- `debugContext`
- `legacyEventType`
- `transaction`
- `uuid`
- `version`
- `request`
- `target`
- `seceng_pipeline_time`

## okta_customer

Query: `#repo=okta_customer | head(1)`

Top-level keys:
- `actor`
- `client`
- `device`
- `authenticationContext`
- `displayMessage`
- `eventType`
- `outcome`
- `published`
- `securityContext`
- `severity`
- `debugContext`
- `legacyEventType`
- `transaction`
- `uuid`
- `version`
- `request`
- `target`
- `seceng_pipeline_time`

## macie

Query: `#repo=macie | head(1)` (24h window)

Top-level keys:
- `schemaVersion`
- `id`
- `accountId`
- `partition`
- `region`
- `severity`
- `createdAt`
- `resourcesAffected`
- `category`
- `classificationDetails`
- `seceng_pipeline_time`

## switches

Query: `#repo=switches | head(1)`

Top-level keys:
- `host`
- `ident`
- `message`
- `seceng_pipeline_time`

## gmail

Query: `#repo=gmail | head(1)`

Top-level keys:
- `gmail`
- `seceng_pipeline_time`

Nested keys:
- `gmail.event_info.timestamp_usec`
- `gmail.event_info.elapsed_time_usec`
- `gmail.event_info.success`
- `gmail.event_info.mail_event_type`
- `gmail.message_info.action_type`
- `gmail.message_info.rfc2822_message_id`
- `gmail.message_info.subject`
- `gmail.message_info.payload_size`
- `gmail.message_info.source.address`
- `gmail.message_info.source.service`
- `gmail.message_info.source.from_header_address`
- `gmail.message_info.source.from_header_displayname`
- `gmail.message_info.destination[].address`
- `gmail.message_info.destination[].service`
- `gmail.message_info.destination[].rcpt_response`
- `gmail.message_info.flattened_destinations`
- `gmail.message_info.description`
- `gmail.message_info.is_spam`
- `gmail.message_info.is_policy_check_for_sender`
- `gmail.message_info.num_message_attachments`
- `gmail.message_info.attachment`
- `gmail.message_info.connection_info.client_ip`
- `gmail.message_info.connection_info.smtp_in_connect_ip`
- `gmail.message_info.connection_info.failed_smtp_out_connect_ip`
- `gmail.message_info.connection_info.smtp_tls_state`
- `gmail.message_info.connection_info.smtp_tls_version`
- `gmail.message_info.connection_info.smtp_tls_cipher`
- `gmail.message_info.connection_info.smtp_reply_code`
- `gmail.message_info.connection_info.smtp_user_agent_ip`
- `gmail.message_info.connection_info.is_intra_domain`
- `gmail.message_info.connection_info.smtp_response_reason`
- `gmail.message_info.connection_info.authenticated_domain[].name`
- `gmail.message_info.connection_info.authenticated_domain[].type`
- `gmail.message_info.connection_info.is_internal`
- `gmail.message_info.connection_info.dkim_pass`
- `gmail.message_info.connection_info.spf_pass`
- `gmail.message_info.message_set[].type`
- `gmail.message_info.triggered_rule_info`
- `gmail.message_info.link_domain`

## windows_events

Query: `#repo=windows_events | head(1)`

Top-level keys:
- `host`
- `ident`
- `message`
- `seceng_pipeline_time`

Notes:
- `message` holds the raw Windows Security Audit payload. If you need parsed
  fields, apply the relevant parser or extract fields in the query.

## google_workspace

Query: `#repo=google_workspace | head(1)`

Top-level keys:
- `login`
- `seceng_pipeline_time`

Nested keys:
- `login.is_suspicious`
- `login.login_type`
- `login.login_challenge_method[]`

## proofpoint_tap

Query: `#repo=proofpoint_tap | head(1)`

Top-level keys:
- `spamScore`
- `phishScore`
- `threatsInfoMap[]`
- `messageTime`
- `impostorScore`
- `malwareScore`
- `cluster`
- `subject`
- `quarantineFolder`
- `quarantineRule`
- `policyRoutes[]`
- `modulesRun[]`
- `messageSize`
- `headerFrom`
- `headerReplyTo`
- `fromAddress[]`
- `ccAddresses[]`
- `replyToAddress[]`
- `toAddresses[]`
- `suborgs`
- `xmailer`
- `messageParts[]`
- `completelyRewritten`
- `id`
- `QID`
- `GUID`
- `sender`
- `recipient[]`
- `senderIP`
- `messageID`
- `event_type`
- `seceng_pipeline_time`

Nested keys:
- `suborgs.sender`
- `suborgs.rcpts[]`
- `messageParts[].disposition`
- `messageParts[].sha256`
- `messageParts[].md5`
- `messageParts[].filename`
- `messageParts[].sandboxStatus`
- `messageParts[].oContentType`
- `messageParts[].contentType`

## one_password

Query: `#repo=one_password | head(1)`

Top-level keys:
- `uuid`
- `timestamp`
- `actor_uuid`
- `actor_details`
- `action`
- `object_type`
- `object_uuid`
- `aux_info`
- `session`
- `location`
- `seceng_pipeline_time`

Nested keys:
- `actor_details.uuid`
- `actor_details.name`
- `actor_details.email`
- `session.uuid`
- `session.login_time`
- `session.device_uuid`
- `session.ip`
- `location.country`
- `location.region`
- `location.city`
- `location.latitude`
- `location.longitude`
