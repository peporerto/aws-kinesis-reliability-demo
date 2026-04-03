import * as cdk from 'aws-cdk-lib';
import * as kinesis from 'aws-cdk-lib/aws-kinesis';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as path from 'path';
import { Construct } from 'constructs';

export class PaystreamPipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Kinesis Stream
    const stream = new kinesis.Stream(this, 'PayStreamInput', {
      streamName: 'PayStreamInput',
      shardCount: 1,
      retentionPeriod: cdk.Duration.hours(24),
    });

    // DynamoDB Table
    const table = new dynamodb.Table(this, 'TransactionsTable', {
      tableName: 'Transactions',
      partitionKey: { name: 'transactionId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PROVISIONED,
      readCapacity: 5,
      writeCapacity: 2,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Lambda Processor
    const processorLambda = new lambda.Function(this, 'ProcessorLambda', {
      functionName: 'PayStreamProcessor',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/processor'), {
        bundling: {
          image: lambda.Runtime.NODEJS_20_X.bundlingImage,
          user: 'root',
          command: [
            'bash', '-c',
            'npm install --cache /tmp/.npm && npm run build && cp -r dist/* /asset-output/ && cp -r node_modules /asset-output/',
          ],
        },
      }),
      environment: {
        TABLE_NAME: table.tableName,
        LOCALSTACK_ENDPOINT: 'http://host.docker.internal:4566',
      },
      timeout: cdk.Duration.seconds(30),
    });

    // Grant Lambda access to DynamoDB and Kinesis
    table.grantWriteData(processorLambda);
    stream.grantRead(processorLambda);

    // Connect Kinesis to Lambda
    processorLambda.addEventSource(new lambdaEventSources.KinesisEventSource(stream, {
      startingPosition: lambda.StartingPosition.TRIM_HORIZON,
      batchSize: 10,
      bisectBatchOnError: true,
    }));
  }
}