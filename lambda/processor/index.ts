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

            // Validación de entrada básica
            if (!payload.id || !payload.amount || !payload.currency) {
                console.error(` Invalid payload structure: ${rawData}`);
                continue; // Saltamos este registro malformado
            }

            //  Idempotencia con ConditionExpression
            await client.send(new PutItemCommand({
                TableName: process.env.TABLE_NAME!,
                Item: {
                    transactionId: { S: payload.id },
                    amount: { N: String(payload.amount) },
                    currency: { S: payload.currency },
                    processedAt: { S: new Date().toISOString() },
                },
                // Esta línea evita duplicados en la base de datos
                ConditionExpression: "attribute_not_exists(transactionId)"
            }));

            console.log(`Processed: ${payload.id}`);

        } catch (error: any) {
            // Manejo específico para el error de duplicado
            if (error.name === "ConditionalCheckFailedException") {
                console.warn(`Duplicate ignored: ${record.kinesis.sequenceNumber}`);
            } else {
                console.error(`Error processing record:`, error.message);
                throw error; // Re-lanzamos para que Kinesis lo mande a la SQS/DLQ
            }
        }
    }
};
