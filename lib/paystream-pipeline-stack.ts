import * as cdk from 'aws-cdk-lib';
import * as kinesis from 'aws-cdk-lib/aws-kinesis';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as path from 'path';
import { Construct } from 'constructs';

export class PaystreamPipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const stream = new kinesis.Stream(this, 'PayStreamInput', {
      streamName: 'PayStreamInput',
      shardCount: 1,
      retentionPeriod: cdk.Duration.hours(24),
    });

    const table = new dynamodb.Table(this, 'TransactionsTable', {
      tableName: 'Transactions',
      partitionKey: { name: 'transactionId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    table.addGlobalSecondaryIndex({
      indexName: 'GSI_ByDate',
      partitionKey: { name: 'entityType', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'processedAt', type: dynamodb.AttributeType.STRING },
    });

    const dlq = new sqs.Queue(this, 'TransactionsDLQ', {
      queueName: 'TransactionsDLQ',
      visibilityTimeout: cdk.Duration.seconds(60),
      retentionPeriod: cdk.Duration.days(7),
    });

    const bundling = {
      image: lambda.Runtime.NODEJS_20_X.bundlingImage,
      user: 'root',
      command: [
        'bash', '-c',
        'npm install --cache /tmp/.npm && npm run build && cp -r dist/* /asset-output/ && cp -r node_modules /asset-output/',
      ],
    };

    const generatorLambda = new lambda.Function(this, 'GeneratorLambda', {
      functionName: 'PayStreamGenerator',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/generator'), { bundling }),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: { STREAM_NAME: stream.streamName },
    });

    const processorLambda = new lambda.Function(this, 'ProcessorLambda', {
      functionName: 'PayStreamProcessor',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/processor'), { bundling }),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: { TABLE_NAME: table.tableName },
    });

    const retrierLambda = new lambda.Function(this, 'RetrierLambda', {
      functionName: 'PayStreamRetrier',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/retrier'), { bundling }),
      timeout: cdk.Duration.seconds(45),
      memorySize: 256,
      environment: { TABLE_NAME: table.tableName },
    });

    const queryLambda = new lambda.Function(this, 'QueryLambda', {
      functionName: 'PayStreamQuery',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/query'), { bundling }),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: { TABLE_NAME: table.tableName },
    });

    stream.grantWrite(generatorLambda);
    stream.grantRead(processorLambda);
    table.grantWriteData(processorLambda);
    table.grantWriteData(retrierLambda);
    table.grantReadData(queryLambda);

    processorLambda.addEventSource(new lambdaEventSources.KinesisEventSource(stream, {
      startingPosition: lambda.StartingPosition.TRIM_HORIZON,
      batchSize: 100,
      bisectBatchOnError: true,
      maxBatchingWindow: cdk.Duration.seconds(5),
      retryAttempts: 2,
      onFailure: new lambdaEventSources.SqsDlq(dlq),
    }));

    retrierLambda.addEventSource(new lambdaEventSources.SqsEventSource(dlq, {
      batchSize: 5,
    }));

    const api = new apigateway.RestApi(this, 'PayStreamApi', {
      restApiName: 'PayStream API',
      description: 'PayStream Inc. transaction API',
    });

    const transactions = api.root.addResource('transactions');
    const transaction = transactions.addResource('{transactionId}');

    transactions.addMethod('POST', new apigateway.LambdaIntegration(generatorLambda));
    transactions.addMethod('GET', new apigateway.LambdaIntegration(queryLambda));
    transaction.addMethod('GET', new apigateway.LambdaIntegration(queryLambda));
  }
}