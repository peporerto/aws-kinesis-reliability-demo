import { KinesisStreamEvent } from 'aws-lambda';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';

const client = new DynamoDBClient({
    endpoint: process.env.LOCALSTACK_HOSTNAME
        ? `http://${process.env.LOCALSTACK_HOSTNAME}:4566`
        : 'http://localhost:4566',
    region: 'us-east-1',
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
});

export const handler = async (event: KinesisStreamEvent): Promise<void> => {
    for (const record of event.Records) {
        const payload = Buffer.from(record.kinesis.data, 'base64').toString('utf-8');
        const transaction = JSON.parse(payload);
        console.log('Decoded data:', payload);
        console.log('Processing transaction:', transaction.id);

        await client.send(new PutItemCommand({
            TableName: process.env.TABLE_NAME!,
            Item: {
                transactionId: { S: transaction.id },
                amount: { N: String(transaction.amount) },
                currency: { S: transaction.currency },
                processedAt: { S: new Date().toISOString() },
            },
        }));

        console.log('Saved transaction:', transaction.id);
    }
};