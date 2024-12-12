import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { PrismaClient } from '@prisma/client';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { OrderPaginationDto } from './dto/order-paginacion.dto';
import { firstValueFrom, last } from 'rxjs';
import { ChangeOrderStatusDto } from './dto';
import { PRODUCT_SERVICE } from 'src/config';

@Injectable()
export class OrdersService extends PrismaClient implements OnModuleInit {
  constructor(
    @Inject(PRODUCT_SERVICE) private readonly productsClient: ClientProxy,
  ) {
    super();
  }
  private readonly logger = new Logger('OrdersService');

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Database Connected');
  }

  async create(createOrderDto: CreateOrderDto) {
    try {
      // Validar que los productos existan con su id
      const productsIds = createOrderDto.items.map((item) => item.productId);
      const products: any[] = await firstValueFrom(
        this.productsClient.send({ cmd: 'validateProducts' }, productsIds),
      );

      // Calculo de los valores
      const totalAmount = createOrderDto.items.reduce((acc, orderItem) => {
        const price = products.find(
          (product) => product.id === orderItem.productId,
        ).price;

        return acc + price * orderItem.quantity;
      }, 0);
      const totalItems = createOrderDto.items.reduce((acc, orderItem) => {
        return acc + orderItem.quantity;
      }, 0);
      console.log(totalAmount);
      // Transaccion de base de datos
      const order = await this.order.create({
        data: {
          totalAmount: totalAmount,
          totalItems: totalItems,
          OrderItem: {
            createMany: {
              data: createOrderDto.items.map((orderItem) => ({
                price: products.find(
                  (product) => product.id === orderItem.productId,
                ).price,
                productId: orderItem.productId,
                quantity: orderItem.quantity,
              })),
            },
          },
        },
        include: {
          OrderItem: {
            select: {
              price: true,
              quantity: true,
              productId: true,
            },
          },
        },
      });
      return {
        ...order,
        OrderItem: order.OrderItem.map((orderItem) => ({
          ...orderItem,
          name: products.find((product) => product.id == orderItem.productId)
            .name,
        })),
      };
    } catch (error) {
      throw new RpcException({
        status: HttpStatus.BAD_REQUEST,
        message: 'No existe uno o mas productos',
      });
    }

    //this.order.create({data: createOrderDto,});
  }

  async findAll(orderPaginationDto: OrderPaginationDto) {
    const totalRecords = await this.order.count({
      where: {
        status: orderPaginationDto.status,
      },
    });

    const currentPage = orderPaginationDto.page;
    const perPage = orderPaginationDto.limit;

    const lastPage = Math.ceil(totalRecords / perPage);

    // Verifica si la página solicitada está fuera del rango válido
    if (currentPage > lastPage || currentPage < 1) {
      return {
        data: [],
        meta: {
          total: totalRecords,
          page: currentPage,
          lastPage,
          message: 'No hay datos disponibles para esta página.',
        },
      };
    }

    // Realiza la consulta paginada si la página es válida
    return {
      data: await this.order.findMany({
        skip: (currentPage - 1) * perPage,
        take: perPage,
        where: {
          status: orderPaginationDto.status,
        },
      }),
      meta: {
        total: totalRecords, // Total de registros
        page: currentPage, // Página actual
        lastPage, // Última página disponible
      },
    };
  }

  async findOne(id: string) {
    const order = await this.order.findFirst({
      where: { id },
      include: {
        OrderItem: {
          select: {
            price: true,
            quantity: true,
            productId: true,
          },
        },
      },
    });

    if (!order) {
      throw new RpcException({
        status: HttpStatus.NOT_FOUND,
        message: `Order with id ${id} not found`,
      });
    }
    const productsIds = order.OrderItem.map((orderItem) => orderItem.productId);
    const products: any[] = await firstValueFrom(
      this.productsClient.send({ cmd: 'validateProducts' }, productsIds),
    );

    return {
      ...order,
      OrderItem: order.OrderItem.map((orderItem) => ({
        ...orderItem,
        name: products.find((product) => product.id == orderItem.productId).name,
      })),
    };
  }

  async changeStatus(changeOrderStatusDto: ChangeOrderStatusDto) {
    const { id, status } = changeOrderStatusDto;

    const order = await this.findOne(id);
    if (order.status == status) {
      return order;
    }
    return this.order.update({
      where: { id },
      data: { status: status },
    });
  }
}
