import { SQSEvent } from 'aws-lambda';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';

const client = new DynamoDBClient({
    endpoint: process.env.LOCALSTACK_HOSTNAME
        ? `http://${process.env.LOCALSTACK_HOSTNAME}:4566`
        : 'http://localhost:4566',
    region: 'us-east-1',
});

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const handler = async (event: SQSEvent): Promise<void> => {
    for (const sqsRecord of event.Records) {
        const body = JSON.parse(sqsRecord.body);
        let payload;

        try {
            const kinesisData = body.requestPayload?.Records?.[0]?.kinesis?.data
                || body.responsePayload?.Records?.[0]?.kinesis?.data
                || body.kinesis?.data
                || body.data;

            if (!kinesisData) {
                console.error('No kinesis data found in body:', JSON.stringify(body, null, 2));
                continue;
            }

            payload = JSON.parse(Buffer.from(kinesisData, 'base64').toString('utf-8'));

            if (!payload.id || !payload.amount || !payload.currency) {
                console.error('Invalid payload structure:', payload);
                continue;
            }

        } catch (e: any) {
            console.error('Error decoding payload:', e.message, JSON.stringify(body));
            continue;
        }

        console.log('Retrying transaction:', payload.id);

        let attempt = 0;
        const maxAttempts = 4;

        while (attempt < maxAttempts) {
            try {
                await client.send(new PutItemCommand({
                    TableName: process.env.TABLE_NAME!,
                    Item: {
                        transactionId: { S: payload.id },
                        amount: { N: String(payload.amount) },
                        currency: { S: payload.currency },
                        processedAt: { S: new Date().toISOString() },
                        retriedAt: { S: new Date().toISOString() },
                    },
                    ConditionExpression: 'attribute_not_exists(transactionId)',
                }));

                console.log(`Transaction ${payload.id} saved on attempt ${attempt + 1}`);
                break;

            } catch (err: any) {
                if (err.name === 'ConditionalCheckFailedException') {
                    console.warn(` Duplicate ignored: ${payload.id}`);
                    break;
                }

                attempt++;
                if (attempt >= maxAttempts) {
                    console.error(`Final failure for ${payload.id} after ${maxAttempts} attempts`);
                    break;
                }

                const waitMs = Math.pow(2, attempt) * 1000;
                console.log(`Attempt ${attempt} failed. Retrying in ${waitMs}ms...`);
                await sleep(waitMs);
            }
        }
    }
};