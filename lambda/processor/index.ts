import { KinesisStreamEvent } from 'aws-lambda';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';

const client = new DynamoDBClient({
    endpoint: process.env.LOCALSTACK_HOSTNAME
        ? `http://${process.env.LOCALSTACK_HOSTNAME}:4566`
        : 'http://localhost:4566',
    region: 'us-east-1',
});

export const handler = async (event: KinesisStreamEvent): Promise<void> => {
    for (const record of event.Records) {
        try {
            const rawData = Buffer.from(record.kinesis.data, 'base64').toString('utf-8');
            const payload = JSON.parse(rawData);

            if (!payload.transactionId || !payload.amount || !payload.currency) {
                console.error('Invalid payload structure:', rawData);
                continue;
            }

            await client.send(new PutItemCommand({
                TableName: process.env.TABLE_NAME!,
                Item: {
                    transactionId: { S: payload.transactionId },
                    entityType: { S: 'TRANSACTION' },
                    amount: { N: String(payload.amount) },
                    currency: { S: payload.currency },
                    processedAt: { S: new Date().toISOString() },
                },
                ConditionExpression: 'attribute_not_exists(transactionId)',
            }));

            console.log(`Processed: ${payload.transactionId}`);

        } catch (error: any) {
            if (error.name === 'ConditionalCheckFailedException') {
                console.warn(`Duplicate ignored: ${record.kinesis.sequenceNumber}`);
            } else {
                console.error('Error processing record:', error.message);
                throw error;
            }
        }
    }
};