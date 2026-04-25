| Method | Path | Case | HTTP | Verdict | Snippet |
|---|---|---|---|---|---|
| POST | /api/v1/auth/register | happy | 400 | OK | {"error":"Validation failed","details":[{"field":"name","message":"Required"},{"… |
| POST | /api/v1/auth/register | no-auth | 400 | OK | {"error":"Validation failed","details":[{"field":"name","message":"Required"},{"… |
| POST | /api/v1/auth/register | garbage | 400 | OK | {"error":"Validation failed","details":[{"field":"name","message":"Required"},{"… |
| POST | /api/v1/auth/login | happy | 400 | OK | {"error":"Validation failed","details":[{"field":"email","message":"Required"},{… |
| POST | /api/v1/auth/login | no-auth | 429 | WARN | {"error":"Too many attempts, please try again later"} |
| POST | /api/v1/auth/login | garbage | 429 | WARN | {"error":"Too many attempts, please try again later"} |
| POST | /api/v1/auth/refresh | happy | - | SKIP | self-sabotages probe |
| POST | /api/v1/auth/refresh | no-auth | 429 | WARN | {"error":"Too many attempts, please try again later"} |
| POST | /api/v1/auth/refresh | garbage | 429 | WARN | {"error":"Too many attempts, please try again later"} |
| POST | /api/v1/auth/logout | skip | - | SKIP | infra-gated |
| GET | /api/v1/auth/me | happy | 200 | OK | {"userId":"aabdc940-99ea-4348-86f2-597a312bc1f4","name":"Probe User 2","email":"… |
| GET | /api/v1/auth/me | no-auth | 401 | OK | {"error":"Authentication required"} |
| GET | /api/v1/auth/me | garbage | 200 | WARN | {"userId":"aabdc940-99ea-4348-86f2-597a312bc1f4","name":"Probe User 2","email":"… |
| POST | /api/v1/auth/change-password | happy | 400 | OK | {"error":"Validation failed","details":[{"field":"currentPassword","message":"Re… |
| POST | /api/v1/auth/change-password | no-auth | 401 | OK | {"error":"Authentication required"} |
| POST | /api/v1/auth/change-password | garbage | 400 | OK | {"error":"Validation failed","details":[{"field":"currentPassword","message":"Re… |
| GET | /api/v1/auth/devices | happy | 200 | OK | {"devices":[],"count":0,"limit":5,"remaining":5} |
| GET | /api/v1/auth/devices | no-auth | 401 | OK | {"error":"Authentication required"} |
| GET | /api/v1/auth/devices | garbage | 200 | WARN | {"devices":[],"count":0,"limit":5,"remaining":5} |
| POST | /api/v1/auth/devices/register | happy | 400 | OK | {"error":"Validation failed","details":[{"field":"deviceId","message":"Required"… |
| POST | /api/v1/auth/devices/register | no-auth | 401 | OK | {"error":"Authentication required"} |
| POST | /api/v1/auth/devices/register | garbage | 400 | OK | {"error":"Validation failed","details":[{"field":"deviceId","message":"Required"… |
| POST | /api/v1/auth/devices/remove | happy | 400 | OK | {"error":"Validation failed","details":[{"field":"deviceId","message":"Required"… |
| POST | /api/v1/auth/devices/remove | no-auth | 401 | OK | {"error":"Authentication required"} |
| POST | /api/v1/auth/devices/remove | garbage | 400 | OK | {"error":"Validation failed","details":[{"field":"deviceId","message":"Required"… |
| GET | /api/v1/auth/billing | happy | 200 | OK | {"email":"probe2-1776554701@hardening.test","tier":"free","createdAt":"2026-04-1… |
| GET | /api/v1/auth/billing | no-auth | 401 | OK | {"error":"Authentication required"} |
| GET | /api/v1/auth/billing | garbage | 200 | WARN | {"email":"probe2-1776554701@hardening.test","tier":"free","createdAt":"2026-04-1… |
| POST | /api/v1/auth/create-portal-session | happy | 200 | OK | {"url":null,"message":"Stripe not configured. Set STRIPE_SECRET_KEY in environme… |
| POST | /api/v1/auth/create-portal-session | no-auth | 401 | OK | {"error":"Authentication required"} |
| POST | /api/v1/auth/create-portal-session | garbage | 200 | WARN | {"url":null,"message":"Stripe not configured. Set STRIPE_SECRET_KEY in environme… |
| GET | /api/v1/identity/me | happy | 200 | OK | {"identity":{"id":"aabdc940-99ea-4348-86f2-597a312bc1f4","windyIdentityId":"5842… |
| GET | /api/v1/identity/me | no-auth | 401 | OK | {"error":"Authentication required"} |
| GET | /api/v1/identity/me | garbage | 200 | WARN | {"identity":{"id":"aabdc940-99ea-4348-86f2-597a312bc1f4","windyIdentityId":"5842… |
| PATCH | /api/v1/identity/me | happy | 400 | OK | {"error":"No fields to update"} |
| PATCH | /api/v1/identity/me | no-auth | 401 | OK | {"error":"Authentication required"} |
| PATCH | /api/v1/identity/me | garbage | 400 | OK | {"error":"No fields to update"} |
| GET | /api/v1/identity/products | happy | 200 | OK | {"products":[{"id":"eee0e14f-2801-4aab-a7a3-f7ebdd7ed393","identity_id":"aabdc94… |
| GET | /api/v1/identity/products | no-auth | 401 | OK | {"error":"Authentication required"} |
| GET | /api/v1/identity/products | garbage | 200 | WARN | {"products":[{"id":"eee0e14f-2801-4aab-a7a3-f7ebdd7ed393","identity_id":"aabdc94… |
| POST | /api/v1/identity/products/provision | happy | 400 | OK | {"error":"Invalid product. Must be one of: windy_pro, windy_chat, windy_mail, wi… |
| POST | /api/v1/identity/products/provision | no-auth | 401 | OK | {"error":"Authentication required"} |
| POST | /api/v1/identity/products/provision | garbage | 400 | OK | {"error":"Invalid product. Must be one of: windy_pro, windy_chat, windy_mail, wi… |
| GET | /api/v1/identity/scopes | happy | 200 | OK | {"scopes":["windy_pro:*"]} |
| GET | /api/v1/identity/scopes | no-auth | 401 | OK | {"error":"Authentication required"} |
| GET | /api/v1/identity/scopes | garbage | 200 | WARN | {"scopes":["windy_pro:*"]} |
| POST | /api/v1/identity/scopes/grant | happy | 403 | WARN | {"error":"Admin access required"} |
| POST | /api/v1/identity/scopes/grant | no-auth | 401 | OK | {"error":"Authentication required"} |
| POST | /api/v1/identity/scopes/grant | garbage | 403 | WARN | {"error":"Admin access required"} |
| DELETE | /api/v1/identity/scopes/:scope | happy | 403 | WARN | {"error":"Admin access required"} |
| DELETE | /api/v1/identity/scopes/:scope | no-auth | 401 | OK | {"error":"Authentication required"} |
| DELETE | /api/v1/identity/scopes/:scope | garbage | 403 | WARN | {"error":"Admin access required"} |
| GET | /api/v1/identity/audit | happy | 200 | OK | {"entries":[{"id":"4b4944f0-9500-4b10-8278-da96259431c8","identity_id":"aabdc940… |
| GET | /api/v1/identity/audit | no-auth | 401 | OK | {"error":"Authentication required"} |
| GET | /api/v1/identity/audit | garbage | 200 | WARN | {"entries":[{"id":"4b4944f0-9500-4b10-8278-da96259431c8","identity_id":"aabdc940… |
| POST | /api/v1/identity/chat/provision | happy | 201 | OK | {"success":true,"creator_name":"Probe User 2","matrix":{"matrixUserId":"@windy_p… |
| POST | /api/v1/identity/chat/provision | no-auth | 401 | OK | {"error":"Authentication required"} |
| POST | /api/v1/identity/chat/provision | garbage | 200 | WARN | {"success":true,"alreadyProvisioned":true,"matrix":{"matrixUserId":"@windy_probe… |
| GET | /api/v1/identity/chat/profile | happy | 200 | OK | {"profile":{"identity_id":"aabdc940-99ea-4348-86f2-597a312bc1f4","chat_user_id":… |
| GET | /api/v1/identity/chat/profile | no-auth | 401 | OK | {"error":"Authentication required"} |
| GET | /api/v1/identity/chat/profile | garbage | 200 | WARN | {"profile":{"identity_id":"aabdc940-99ea-4348-86f2-597a312bc1f4","chat_user_id":… |
| POST | /api/v1/identity/api-keys | happy | 400 | OK | {"error":"identityId and scopes[] are required"} |
| POST | /api/v1/identity/api-keys | no-auth | 401 | OK | {"error":"Authentication required"} |
| POST | /api/v1/identity/api-keys | garbage | 400 | OK | {"error":"identityId and scopes[] are required"} |
| DELETE | /api/v1/identity/api-keys/:keyId | happy | 200 | OK | {"revoked":false} |
| DELETE | /api/v1/identity/api-keys/:keyId | no-auth | 401 | OK | {"error":"Authentication required"} |
| DELETE | /api/v1/identity/api-keys/:keyId | garbage | 200 | WARN | {"revoked":false} |
| GET | /api/v1/identity/api-keys | happy | 200 | OK | {"keys":[]} |
| GET | /api/v1/identity/api-keys | no-auth | 401 | OK | {"error":"Authentication required"} |
| GET | /api/v1/identity/api-keys | garbage | 200 | WARN | {"keys":[]} |
| POST | /api/v1/identity/secretary/consent | happy | 400 | OK | {"error":"botIdentityId is required"} |
| POST | /api/v1/identity/secretary/consent | no-auth | 401 | OK | {"error":"Authentication required"} |
| POST | /api/v1/identity/secretary/consent | garbage | 400 | OK | {"error":"botIdentityId is required"} |
| GET | /api/v1/identity/secretary/status | happy | 200 | OK | {"consented":false,"identity_type":"human","message":"Secretary consent is only … |
| GET | /api/v1/identity/secretary/status | no-auth | 401 | OK | {"error":"Authentication required"} |
| GET | /api/v1/identity/secretary/status | garbage | 200 | WARN | {"consented":false,"identity_type":"human","message":"Secretary consent is only … |
| POST | /api/v1/identity/eternitas/webhook | happy | 401 | WARN | {"error":"Missing webhook signature"} |
| POST | /api/v1/identity/eternitas/webhook | no-auth | 401 | OK | {"error":"Missing webhook signature"} |
| POST | /api/v1/identity/eternitas/webhook | garbage | 401 | OK | {"error":"Missing webhook signature"} |
| POST | /api/v1/identity/hatch/credentials | happy | 403 | WARN | {"error":"Admin access required"} |
| POST | /api/v1/identity/hatch/credentials | no-auth | 401 | OK | {"error":"Authentication required"} |
| POST | /api/v1/identity/hatch/credentials | garbage | 403 | WARN | {"error":"Admin access required"} |
| POST | /api/v1/identity/backfill | happy | 403 | WARN | {"error":"Admin access required"} |
| POST | /api/v1/identity/backfill | no-auth | 401 | OK | {"error":"Authentication required"} |
| POST | /api/v1/identity/backfill | garbage | 403 | WARN | {"error":"Admin access required"} |
| POST | /api/v1/identity/verify/send | happy | 400 | OK | {"error":"Validation failed","details":[{"field":"type","message":"Required"},{"… |
| POST | /api/v1/identity/verify/send | no-auth | 401 | OK | {"error":"Authentication required"} |
| POST | /api/v1/identity/verify/send | garbage | 400 | OK | {"error":"Validation failed","details":[{"field":"type","message":"Required"},{"… |
| POST | /api/v1/identity/verify/check | happy | 400 | OK | {"error":"Validation failed","details":[{"field":"identifier","message":"Require… |
| POST | /api/v1/identity/verify/check | no-auth | 401 | OK | {"error":"Authentication required"} |
| POST | /api/v1/identity/verify/check | garbage | 400 | OK | {"error":"Validation failed","details":[{"field":"identifier","message":"Require… |
| GET | /api/v1/identity/verify/status | happy | 200 | OK | {"email":"probe2-1776554701@hardening.test","emailVerified":false,"phone":null,"… |
| GET | /api/v1/identity/verify/status | no-auth | 401 | OK | {"error":"Authentication required"} |
| GET | /api/v1/identity/verify/status | garbage | 200 | WARN | {"email":"probe2-1776554701@hardening.test","emailVerified":false,"phone":null,"… |
| POST | /api/v1/oauth/clients | happy | 403 | WARN | {"error":"Admin access required"} |
| POST | /api/v1/oauth/clients | no-auth | 401 | OK | {"error":"Authentication required"} |
| POST | /api/v1/oauth/clients | garbage | 403 | WARN | {"error":"Admin access required"} |
| GET | /api/v1/oauth/clients | happy | 403 | WARN | {"error":"Admin access required"} |
| GET | /api/v1/oauth/clients | no-auth | 401 | OK | {"error":"Authentication required"} |
| GET | /api/v1/oauth/clients | garbage | 403 | WARN | {"error":"Admin access required"} |
| GET | /api/v1/oauth/authorize | happy | 400 | OK | {"error":"unsupported_response_type","error_description":"Only response_type=cod… |
| GET | /api/v1/oauth/authorize | no-auth | 401 | OK | {"error":"Authentication required"} |
| GET | /api/v1/oauth/authorize | garbage | 400 | OK | {"error":"unsupported_response_type","error_description":"Only response_type=cod… |
| POST | /api/v1/oauth/authorize | happy | 400 | OK | {"error":"invalid_request","error_description":"client_id and redirect_uri are r… |
| POST | /api/v1/oauth/authorize | no-auth | 401 | OK | {"error":"Authentication required"} |
| POST | /api/v1/oauth/authorize | garbage | 400 | OK | {"error":"invalid_request","error_description":"client_id and redirect_uri are r… |
| POST | /api/v1/oauth/token | happy | 400 | OK | {"error":"unsupported_grant_type","error_description":"Grant type 'undefined' is… |
| POST | /api/v1/oauth/token | no-auth | 400 | OK | {"error":"unsupported_grant_type","error_description":"Grant type 'undefined' is… |
| POST | /api/v1/oauth/token | garbage | 400 | OK | {"error":"unsupported_grant_type","error_description":"Grant type 'undefined' is… |
| POST | /api/v1/oauth/device | happy | 400 | OK | {"error":"invalid_request","error_description":"client_id is required"} |
| POST | /api/v1/oauth/device | no-auth | 400 | OK | {"error":"invalid_request","error_description":"client_id is required"} |
| POST | /api/v1/oauth/device | garbage | 400 | OK | {"error":"invalid_request","error_description":"client_id is required"} |
| POST | /api/v1/oauth/device/approve | happy | 400 | OK | {"error":"user_code is required"} |
| POST | /api/v1/oauth/device/approve | no-auth | 401 | OK | {"error":"Authentication required"} |
| POST | /api/v1/oauth/device/approve | garbage | 400 | OK | {"error":"user_code is required"} |
| GET | /api/v1/oauth/userinfo | happy | 200 | OK | {"sub":"58423bba-9d66-411b-8fcb-072176a2a0fb","name":"Probe User 2","preferred_u… |
| GET | /api/v1/oauth/userinfo | no-auth | 401 | OK | {"error":"Authentication required"} |
| GET | /api/v1/oauth/userinfo | garbage | 200 | WARN | {"sub":"58423bba-9d66-411b-8fcb-072176a2a0fb","name":"Probe User 2","preferred_u… |
| GET | /api/v1/oauth/consents | happy | 200 | OK | {"consents":[]} |
| GET | /api/v1/oauth/consents | no-auth | 401 | OK | {"error":"Authentication required"} |
| GET | /api/v1/oauth/consents | garbage | 200 | WARN | {"consents":[]} |
| DELETE | /api/v1/oauth/consents/:clientId | happy | 200 | OK | {"revoked":false} |
| DELETE | /api/v1/oauth/consents/:clientId | no-auth | 401 | OK | {"error":"Authentication required"} |
| DELETE | /api/v1/oauth/consents/:clientId | garbage | 200 | WARN | {"revoked":false} |
| GET | /api/v1/oauth/consent | happy | 400 | OK | {"error":"client_id is required"} |
| GET | /api/v1/oauth/consent | no-auth | 401 | OK | {"error":"Authentication required"} |
| GET | /api/v1/oauth/consent | garbage | 400 | OK | {"error":"client_id is required"} |
| GET | /api/v1/recordings | happy | 200 | OK | {"recordings":[],"bundles":[],"total":0,"page":1,"limit":50,"totalPages":0,"hasM… |
| GET | /api/v1/recordings | no-auth | 401 | OK | {"error":"Authentication required"} |
| GET | /api/v1/recordings | garbage | 200 | WARN | {"recordings":[],"bundles":[],"total":0,"page":1,"limit":50,"totalPages":0,"hasM… |
| GET | /api/v1/recordings/list | happy | 200 | OK | {"recordings":[],"bundles":[],"total":0,"page":1,"limit":50,"totalPages":0,"hasM… |
| GET | /api/v1/recordings/list | no-auth | 401 | OK | {"error":"Authentication required"} |
| GET | /api/v1/recordings/list | garbage | 200 | WARN | {"recordings":[],"bundles":[],"total":0,"page":1,"limit":50,"totalPages":0,"hasM… |
| GET | /api/v1/recordings/check | happy | 400 | OK | {"error":"bundle_id parameter required"} |
| GET | /api/v1/recordings/check | no-auth | 401 | OK | {"error":"Authentication required"} |
| GET | /api/v1/recordings/check | garbage | 400 | OK | {"error":"bundle_id parameter required"} |
| GET | /api/v1/recordings/stats | happy | 200 | OK | {"totalRecordings":0,"totalDuration":0,"totalHours":0,"totalWords":0,"totalSize"… |
| GET | /api/v1/recordings/stats | no-auth | 401 | OK | {"error":"Authentication required"} |
| GET | /api/v1/recordings/stats | garbage | 200 | WARN | {"totalRecordings":0,"totalDuration":0,"totalHours":0,"totalWords":0,"totalSize"… |
| GET | /api/v1/recordings/:id | happy | 404 | OK | {"error":"Recording not found"} |
| GET | /api/v1/recordings/:id | no-auth | 401 | OK | {"error":"Authentication required"} |
| GET | /api/v1/recordings/:id | garbage | 404 | OK | {"error":"Recording not found"} |
| DELETE | /api/v1/recordings/:id | happy | 404 | OK | {"error":"Recording not found"} |
| DELETE | /api/v1/recordings/:id | no-auth | 401 | OK | {"error":"Authentication required"} |
| DELETE | /api/v1/recordings/:id | garbage | 404 | OK | {"error":"Recording not found"} |
| POST | /api/v1/recordings/upload | happy | 500 | BAD | {"error":"Internal server error"} |
| POST | /api/v1/recordings/upload | no-auth | 401 | OK | {"error":"Authentication required"} |
| POST | /api/v1/recordings/upload | garbage | 500 | BAD | {"error":"Internal server error"} |
| POST | /api/v1/recordings/upload/chunk | happy | 400 | OK | {"error":"bundle_id, chunk_index, and total_chunks are required"} |
| POST | /api/v1/recordings/upload/chunk | no-auth | 401 | OK | {"error":"Authentication required"} |
| POST | /api/v1/recordings/upload/chunk | garbage | 400 | OK | {"error":"bundle_id, chunk_index, and total_chunks are required"} |
| POST | /api/v1/recordings/upload/batch | happy | 400 | OK | {"error":"Request body must be a JSON array of recording objects"} |
| POST | /api/v1/recordings/upload/batch | no-auth | 401 | OK | {"error":"Authentication required"} |
| POST | /api/v1/recordings/upload/batch | garbage | 400 | OK | {"error":"Request body must be a JSON array of recording objects"} |
| POST | /api/v1/recordings/sync | happy | 400 | OK | {"error":"bundles array required"} |
| POST | /api/v1/recordings/sync | no-auth | 401 | OK | {"error":"Authentication required"} |
| POST | /api/v1/recordings/sync | garbage | 400 | OK | {"error":"bundles array required"} |
| GET | /api/v1/recordings/:id/video | happy | 404 | OK | {"error":"Recording not found"} |
| GET | /api/v1/recordings/:id/video | no-auth | 401 | OK | {"error":"Authentication required"} |
| GET | /api/v1/recordings/:id/video | garbage | 404 | OK | {"error":"Recording not found"} |
| POST | /api/v1/transcribe | happy | 400 | OK | {"error":"No audio file provided. Send as multipart field \"audio\"."} |
| POST | /api/v1/transcribe | no-auth | 401 | OK | {"error":"Authentication required"} |
| POST | /api/v1/transcribe | garbage | 400 | OK | {"error":"No audio file provided. Send as multipart field \"audio\"."} |
| POST | /api/v1/transcribe/batch | happy | 400 | OK | {"error":"No audio files provided."} |
| POST | /api/v1/transcribe/batch | no-auth | 401 | OK | {"error":"Authentication required"} |
| POST | /api/v1/transcribe/batch | garbage | 400 | OK | {"error":"No audio files provided."} |
| POST | /api/v1/translate/text | happy | 400 | OK | {"error":"Validation failed","details":[{"field":"text","message":"Required"}]} |
| POST | /api/v1/translate/text | no-auth | 401 | OK | {"error":"Authentication required"} |
| POST | /api/v1/translate/text | garbage | 400 | OK | {"error":"Validation failed","details":[{"field":"text","message":"Required"}]} |
| POST | /api/v1/translate/speech | happy | 400 | OK | {"error":"Validation failed","details":[{"field":"","message":"sourceLang/source… |
| POST | /api/v1/translate/speech | no-auth | 401 | OK | {"error":"Authentication required"} |
| POST | /api/v1/translate/speech | garbage | 400 | OK | {"error":"Validation failed","details":[{"field":"","message":"sourceLang/source… |
| GET | /api/v1/translate/languages | happy | 200 | OK | {"languages":[{"code":"en","name":"English"},{"code":"es","name":"Spanish"},{"co… |
| GET | /api/v1/translate/languages | no-auth | 200 | BAD | {"languages":[{"code":"en","name":"English"},{"code":"es","name":"Spanish"},{"co… |
| GET | /api/v1/translate/languages | garbage | 200 | WARN | {"languages":[{"code":"en","name":"English"},{"code":"es","name":"Spanish"},{"co… |
| GET | /api/v1/user/history | happy | 200 | OK | {"translations":[],"total":0,"languages":[],"favoriteCount":0,"history":[],"pagi… |
| GET | /api/v1/user/history | no-auth | 401 | OK | {"error":"Authentication required"} |
| GET | /api/v1/user/history | garbage | 200 | WARN | {"translations":[],"total":0,"languages":[],"favoriteCount":0,"history":[],"pagi… |
| POST | /api/v1/user/favorites | happy | 400 | OK | {"error":"translationId is required"} |
| POST | /api/v1/user/favorites | no-auth | 401 | OK | {"error":"Authentication required"} |
| POST | /api/v1/user/favorites | garbage | 400 | OK | {"error":"translationId is required"} |
| POST | /api/v1/files/upload | happy | 400 | OK | {"error":"No file provided"} |
| POST | /api/v1/files/upload | no-auth | 401 | OK | {"error":"Authentication required"} |
| POST | /api/v1/files/upload | garbage | 400 | OK | {"error":"No file provided"} |
| GET | /api/v1/files | happy | 200 | OK | {"ok":true,"files":[],"total":0,"storageUsed":0,"storageLimit":524288000} |
| GET | /api/v1/files | no-auth | 401 | OK | {"error":"Authentication required"} |
| GET | /api/v1/files | garbage | 500 | BAD | {"error":"Internal server error"} |
| GET | /api/v1/files/:fileId | happy | 404 | OK | {"error":"File not found"} |
| GET | /api/v1/files/:fileId | no-auth | 401 | OK | {"error":"Authentication required"} |
| GET | /api/v1/files/:fileId | garbage | 404 | OK | {"error":"File not found"} |
| DELETE | /api/v1/files/:fileId | happy | 404 | OK | {"error":"File not found"} |
| DELETE | /api/v1/files/:fileId | no-auth | 401 | OK | {"error":"Authentication required"} |
| DELETE | /api/v1/files/:fileId | garbage | 404 | OK | {"error":"File not found"} |
| GET | /api/v1/clone/training-data | happy | 200 | OK | {"bundles":[],"total":0} |
| GET | /api/v1/clone/training-data | no-auth | 401 | OK | {"error":"Authentication required"} |
| GET | /api/v1/clone/training-data | garbage | 200 | WARN | {"bundles":[],"total":0} |
| POST | /api/v1/clone/start-training | happy | 400 | OK | {"error":"Validation failed","details":[{"field":"bundle_ids","message":"Require… |
| POST | /api/v1/clone/start-training | no-auth | 401 | OK | {"error":"Authentication required"} |
| POST | /api/v1/clone/start-training | garbage | 400 | OK | {"error":"Validation failed","details":[{"field":"bundle_ids","message":"Require… |
| POST | /api/v1/stripe/webhook | skip | - | SKIP | infra-gated |
| GET | /api/v1/billing/transactions | happy | 200 | OK | {"ok":true,"transactions":[],"total":0,"limit":50,"offset":0} |
| GET | /api/v1/billing/transactions | no-auth | 401 | OK | {"error":"Authentication required"} |
| GET | /api/v1/billing/transactions | garbage | 500 | BAD | {"error":"Internal server error"} |
| GET | /api/v1/billing/summary | happy | 200 | OK | {"ok":true,"totalSpent":0,"activeSubscriptions":0,"tier":"free","storageUsed":0,… |
| GET | /api/v1/billing/summary | no-auth | 401 | OK | {"error":"Authentication required"} |
| GET | /api/v1/billing/summary | garbage | 200 | WARN | {"ok":true,"totalSpent":0,"activeSubscriptions":0,"tier":"free","storageUsed":0,… |
