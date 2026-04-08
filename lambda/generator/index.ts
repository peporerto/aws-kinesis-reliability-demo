import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { KinesisClient, PutRecordCommand } from '@aws-sdk/client-kinesis';
import { ulid } from 'ulid';

const kinesis = new KinesisClient({
    endpoint: process.env.LOCALSTACK_HOSTNAME
        ? `http://${process.env.LOCALSTACK_HOSTNAME}:4566`
        : 'http://localhost:4566',
    region: 'us-east-1',
});

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        const body = JSON.parse(event.body || '{}');

        if (!body.amount || !body.currency) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: 'amount and currency are required' }),
            };
        }

        const transactionId = ulid();

        const transaction = {
            transactionId: transactionId,
            amount: body.amount,
            currency: body.currency,
            createdAt: new Date().toISOString(),
        };

        await kinesis.send(new PutRecordCommand({
            StreamName: process.env.STREAM_NAME!,
            Data: Buffer.from(JSON.stringify(transaction)),
            PartitionKey: transactionId,
        }));

        console.log(`Transaction created: ${transactionId}`);

        return {
            statusCode: 202,
            body: JSON.stringify({
                transactionId,
                message: 'Transaction accepted and queued for processing',
            }),
        };

    } catch (err: any) {
        console.error('Generator error:', err.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Internal server error' }),
        };
    }
};