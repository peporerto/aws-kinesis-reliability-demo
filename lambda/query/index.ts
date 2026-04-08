import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, GetItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';

const client = new DynamoDBClient({
    endpoint: process.env.LOCALSTACK_HOSTNAME
        ? `http://${process.env.LOCALSTACK_HOSTNAME}:4566`
        : 'http://localhost:4566',
    region: 'us-east-1',
});

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        const transactionId = event.pathParameters?.transactionId;

        if (transactionId) {
            const result = await client.send(new GetItemCommand({
                TableName: process.env.TABLE_NAME!,
                Key: { transactionId: { S: transactionId } },
            }));

            if (!result.Item) {
                return { statusCode: 404, body: JSON.stringify({ message: 'Transaction not found' }) };
            }

            return {
                statusCode: 200,
                body: JSON.stringify({
                    transactionId: result.Item.transactionId.S,
                    amount: result.Item.amount.N,
                    currency: result.Item.currency.S,
                    processedAt: result.Item.processedAt.S,
                    retriedAt: result.Item.retriedAt?.S || null,
                }),
            };
        }

        const result = await client.send(new QueryCommand({
            TableName: process.env.TABLE_NAME!,
            IndexName: 'GSI_ByDate',
            KeyConditionExpression: 'entityType = :type',
            ExpressionAttributeValues: {
                ':type': { S: 'TRANSACTION' },
            },
            ScanIndexForward: false,
            Limit: 50,
        }));

        const items = (result.Items || []).map(item => ({
            transactionId: item.transactionId.S,
            amount: item.amount.N,
            currency: item.currency.S,
            processedAt: item.processedAt.S,
            retriedAt: item.retriedAt?.S || null,
        }));

        return {
            statusCode: 200,
            body: JSON.stringify({ count: items.length, transactions: items }),
        };

    } catch (err: any) {
        console.error('Query error:', err.message);
        return { statusCode: 500, body: JSON.stringify({ message: 'Internal server error' }) };
    }
};