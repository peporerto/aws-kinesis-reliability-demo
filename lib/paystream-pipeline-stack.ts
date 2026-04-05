import * as cdk from 'aws-cdk-lib';
import * as kinesis from 'aws-cdk-lib/aws-kinesis';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as path from 'path';
import { Construct } from 'constructs';
import * as sqs from 'aws-cdk-lib/aws-sqs';

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
      writeCapacity: 1,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Dead Letter Queue
    const dlq = new sqs.Queue(this, 'TransactionsDLQ', {
      queueName: 'TransactionsDLQ',
      visibilityTimeout: cdk.Duration.seconds(60),
      retentionPeriod: cdk.Duration.days(7),
    });
    // Retrier Lambda
    const retrierLambda = new lambda.Function(this, 'RetrierLambda', {
      functionName: 'PayStreamRetrier',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/retrier'), {
        bundling: {
          image: lambda.Runtime.NODEJS_20_X.bundlingImage,
          user: 'root',
          command: [
            'bash', '-c',
            'npm install --cache /tmp/.npm && npm run build && cp -r dist/* /asset-output/ && cp -r node_modules /asset-output/',
          ],
        },
      }),
      timeout: cdk.Duration.seconds(45), // Must be longer than your max sleep time (approx 30s)
      environment: {
        TABLE_NAME: table.tableName,
      },
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
      timeout: cdk.Duration.seconds(30),
      environment: {
        TABLE_NAME: table.tableName,
      },
    });

    // Grant Lambda access to DynamoDB and Kinesis
    table.grantWriteData(processorLambda);
    stream.grantRead(processorLambda);

    // Connect Kinesis to Lambda
    processorLambda.addEventSource(new lambdaEventSources.KinesisEventSource(stream, {
      startingPosition: lambda.StartingPosition.TRIM_HORIZON,
      batchSize: 50,
      bisectBatchOnError: true,
      retryAttempts: 2,
      onFailure: new lambdaEventSources.SqsDlq(dlq),
    }));
    // 1. Grant Retrier access to DynamoDB
    table.grantWriteData(retrierLambda);

    // 2. Trigger Retrier whenever there is a message in the DLQ
    retrierLambda.addEventSource(new lambdaEventSources.SqsEventSource(dlq, {
      batchSize: 5, // Process in smaller batches to respect DynamoDB limits
    }));

  }
}